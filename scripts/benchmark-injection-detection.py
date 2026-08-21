#!/usr/bin/env python3
"""Measure what the Layer 0 gate actually catches, against public corpora.

NON-GATING. This is a maintainer-run benchmark, not a CI check. It fetches
third-party datasets over the network, which is exactly what must not sit in
the release path -- run it deliberately, read the number, act on it.

WHY THIS EXISTS
---------------
scripts/security-injection.py claims it catches HIDING rather than persuasion.
That claim should be a measurement rather than a sentence in a docstring, and
this produces the measurement.

Expect a LOW catch rate, and read a low number as confirmation rather than
failure. These corpora are plain-text jailbreak prompts: no invisible carriers,
no smuggling, nothing concealed. They are the half the gate deliberately does
not cover, so a low score is the honest shape of the result. What would be
alarming is the opposite -- a high score would mean the gate is leaning on a
phrase list, which cannot survive translation or paraphrase.

The number worth watching over time is the SHAPE of the misses, not the rate.

The detectors are imported from the gate itself rather than reimplemented. A
benchmark that reimplements what it measures grades its own copy; this repo has
already been bitten by a regression test that hand-rolled the production SQL it
was supposed to guard.

Usage:
    scripts/benchmark-injection-detection.py --fetch
    scripts/benchmark-injection-detection.py --corpus mine.jsonl
"""

import argparse
import importlib.util
import json
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Public, Apache-2.0 or similar, fetched read-only. Deliberately NOT vendored:
# they are stale (deepset last moved in 2024) and vendoring would add
# maintenance and paperwork for a corpus we only ever read.
CORPORA = [
    ("deepset/prompt-injections", "default", "train"),
    ("rikka-snow/prompt-injection-multilingual", "default", "train"),
]
ROWS_URL = (
    "https://datasets-server.huggingface.co/rows"
    "?dataset={ds}&config={cfg}&split={split}&offset={off}&length={n}"
)


def load_gate():
    """Import the live gate module, hyphenated filename and all."""
    spec = importlib.util.spec_from_file_location(
        "cbm_injection_gate", HERE / "security-injection.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def detectors(gate):
    """Map tier name -> predicate(text) -> matched fragment or None."""

    def tier1(text):
        for ch in text:
            if gate.classify(ord(ch)):
                return f"U+{ord(ch):04X}"
        return None

    def tier2(text):
        words = [w for w in text.split(" ") if w]
        if len(words) >= gate.PARSER_PROSE_WORDS:
            return f"{len(words)} words"
        run = gate._longest_nonascii_letter_run(text)
        if run >= gate.PARSER_PROSE_SCRIPT_RUN:
            return f"{run}-char non-Latin run"
        return None

    def make(patterns):
        def check(text):
            for pattern, label in patterns:
                m = pattern.search(text)
                if m:
                    return f"{label}: {m.group(0)[:40]!r}"
            return None

        return check

    return {
        "tier1 carrier Unicode": tier1,
        "tier2 prose-shape": tier2,
        "tier3a framing tokens": make(gate.FRAMING_TOKENS),
        "tier3b phrasing": make(gate.INJECTION_PHRASES),
    }


def fetch(dataset, config, split, limit=1000):
    rows, offset = [], 0
    while offset < limit:
        url = ROWS_URL.format(
            ds=dataset.replace("/", "%2F"), cfg=config, split=split,
            off=offset, n=min(100, limit - offset),
        )
        try:
            with urllib.request.urlopen(url, timeout=30) as fh:
                payload = json.load(fh)
        except Exception as exc:  # noqa: BLE001 - report and continue
            print(f"  ! {dataset}: {exc}")
            break
        batch = payload.get("rows", [])
        if not batch:
            break
        rows.extend(r["row"] for r in batch)
        offset += len(batch)
        if offset >= payload.get("num_rows_total", 0):
            break
    return rows


def text_of(row):
    for key in ("text", "prompt", "input", "content", "instruction"):
        if isinstance(row.get(key), str) and row[key].strip():
            return row[key]
    return None


def is_injection(row):
    for key in ("label", "is_injection", "malicious", "jailbreak"):
        if key in row:
            v = row[key]
            if isinstance(v, bool):
                return v
            if isinstance(v, (int, float)):
                return int(v) == 1
            if isinstance(v, str):
                return v.strip().lower() in {"1", "true", "injection", "malicious"}
    return None


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--fetch", action="store_true",
                    help="download the public corpora (network access)")
    ap.add_argument("--corpus", type=Path, action="append", default=[],
                    help="local JSONL with a text field (repeatable)")
    ap.add_argument("--limit", type=int, default=1000)
    ap.add_argument("--show-misses", type=int, default=8)
    args = ap.parse_args(argv)

    if not args.fetch and not args.corpus:
        ap.error("pass --fetch or --corpus; this never reaches the network implicitly")

    gate = load_gate()
    checks = detectors(gate)

    samples = []
    for path in args.corpus:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                samples.append((path.name, json.loads(line)))
    if args.fetch:
        print("Fetching public corpora (read-only, no credentials):")
        for ds, cfg, split in CORPORA:
            rows = fetch(ds, cfg, split, args.limit)
            print(f"  {ds}: {len(rows)} rows")
            samples.extend((ds, r) for r in rows)

    positives = [(src, t) for src, r in samples
                 if (t := text_of(r)) and is_injection(r) is not False]
    print(f"\nsamples: {len(samples)}, treated as injections: {len(positives)}")
    if not positives:
        print("nothing to measure")
        return 0

    # Tier 2 is SCOPED to string literals inside generated parser symbol
    # tables. Applied to free prose it matches almost everything -- any English
    # sentence has four words -- which would produce a flattering number that
    # measures nothing. So it is reported under its own threat model rather
    # than folded into the headline.
    FREE_PROSE = ["tier1 carrier Unicode", "tier3a framing tokens",
                  "tier3b phrasing"]
    SMUGGLED = ["tier2 prose-shape"]

    caught = {k: 0 for k in checks}
    prose_misses = []
    for src, text in positives:
        matched_prose = False
        for name, check in checks.items():
            if check(text):
                caught[name] += 1
                if name in FREE_PROSE:
                    matched_prose = True
        if not matched_prose:
            prose_misses.append((src, text))

    total = len(positives)
    caught_prose = total - len(prose_misses)

    print("\n--- THREAT MODEL A: the payload arrives as visible prose ---")
    print("    (a README, an issue body, a docstring -- nothing concealed)")
    for name in FREE_PROSE:
        n = caught[name]
        print(f"  {n * 100.0 / total:5.1f}%  {n:>4}/{total}  {name}")
    print(f"  {caught_prose * 100.0 / total:5.1f}%  {caught_prose:>4}/{total}  ANY applicable tier")
    print("\n  This is the half the gate does NOT claim to cover, and the low")
    print("  number is the honest confirmation of that. Catching visible prose")
    print("  needs a phrase list, which translation and paraphrase defeat.")

    print("\n--- THREAT MODEL B: the same payload smuggled into a generated ---")
    print("    parser's symbol table (the #1033 / #1179 review scenario)")
    for name in SMUGGLED:
        n = caught[name]
        print(f"  {n * 100.0 / total:5.1f}%  {n:>4}/{total}  {name}")
    print("\n  Near-total, because prose is structurally anomalous THERE even")
    print("  though it is unremarkable in a README. Same text, different")
    print("  location, opposite verdict -- which is the whole design.")

    print(f"\nMissed under threat model A ({len(prose_misses)}); the shape is the point:")
    for src, text in prose_misses[: args.show_misses]:
        flat = " ".join(text.split())
        print(f"  [{src}] {flat[:110]!r}")

    print("\nWatch the SHAPE of the misses over time, not the rate.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
