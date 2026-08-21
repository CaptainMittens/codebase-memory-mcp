#!/usr/bin/env python3
"""Layer 0: hidden-instruction audit -- source-level check on the whole tree.

Scans every tracked file for Unicode that is INVISIBLE or DIRECTION-CONTROLLING
in a normal editor and diff view, but which a language model reading the file
still consumes. Those characters are the carrier layer of indirect prompt
injection: zero-width sequences, bidirectional overrides (Trojan Source), the
Unicode Tags block, and stray byte-order marks.

WHY THIS IS A HARD GATE AND A KEYWORD LIST IS NOT
------------------------------------------------
The persuasion layer of an injection ("ignore previous instructions...") is
natural language, so it is unbounded and translatable -- published refusal rates
fall from roughly 79% in English to as low as 23% in some low-resource
languages, and a homoglyph substitution defeats a keyword match outright. A word
list cannot gate that honestly.

The CARRIER layer is different. It is finite, it is language-independent, and it
has no legitimate use in source code at all. That makes it gateable with a false
positive rate near zero: this check reports what it found rather than what it
guessed, and "no invisible characters are present" is an arithmetic statement
rather than a judgement.

This check therefore catches HIDING, not persuasion. Plain visible text that
argues with a model passes it, by design. Do not read a green result as "no
injection"; read it as "nothing is concealed from the reviewer", which is what
makes ordinary human review trustworthy.

ALLOWLIST
---------
scripts/injection-allowlist.txt, one entry per line:

    <sha256>  <path>  # why this occurrence is safe

The sha256 is of the LINE that contains the character, not of the file, and the
line is located by content rather than by number. Editing anything elsewhere in
the file does not disturb the entry; editing the blessed line itself invalidates
it and the gate fails. That is deliberate -- an attacker who appends to an
already-blessed region must also update a checksum, which turns an invisible
edit into a one-line diff a reviewer can see.

Entries require a written justification. `--update` emits a placeholder that
this gate rejects, so an allowlist entry cannot be produced mechanically.
"""

import hashlib
import re
import subprocess
import sys
from pathlib import Path

# Carrier codepoints. Every range here is invisible or direction-controlling in
# a normal editor; none has a legitimate use in source. Ordinary non-ASCII --
# em dashes, box-drawing banners, CJK in the i18n strings -- is NOT listed and
# must never be, or the gate becomes noise and gets switched off.
CARRIERS = {
    (0x200B, 0x200F): "zero-width / directional mark",
    (0x202A, 0x202E): "bidirectional override (Trojan Source)",
    (0x2060, 0x2064): "word joiner / invisible operator",
    (0x2066, 0x2069): "directional isolate",
    (0xFEFF, 0xFEFF): "byte-order mark",
    (0x00AD, 0x00AD): "soft hyphen",
    (0xE0000, 0xE007F): "Unicode Tags block (invisible instruction carrier)",
}

ALLOWLIST = "scripts/injection-allowlist.txt"
PLACEHOLDER = "TODO"


# Flattened for lookup speed: the gate scans every character of every
# non-ASCII file, so a set membership test beats walking the ranges.
_CARRIER_LABEL = {
    cp: label
    for (low, high), label in CARRIERS.items()
    for cp in range(low, high + 1)
}


def classify(codepoint):
    return _CARRIER_LABEL.get(codepoint)


def tracked_files(root):
    out = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-z"],
        capture_output=True, check=True,
    ).stdout
    return [p.decode() for p in out.split(b"\0") if p]


def scan(root):
    """Yield (path, line_no, line_text, sha256_of_line, [(char, label), ...])."""
    for rel in tracked_files(root):
        full = root / rel
        try:
            raw = full.read_bytes()
        except (OSError, ValueError):
            continue
        # Fast path: a pure-ASCII file cannot hold a carrier. `bytes.isascii`
        # is a C-level scan; the equivalent Python loop more than doubles the
        # runtime of the whole gate on this tree.
        if raw.isascii():
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue  # binary; not a review surface
        # Second fast path: check the file once before doing per-line work.
        if not any(classify(ord(ch)) for ch in text):
            continue
        for line_no, line in enumerate(text.split("\n"), 1):
            found = [
                (ch, classify(ord(ch))) for ch in line if classify(ord(ch))
            ]
            if found:
                digest = hashlib.sha256(line.encode("utf-8")).hexdigest()
                yield rel, line_no, line, digest, found


# ── Tier 2: scoped structural checks ───────────────────────────────────
#
# Every threshold here was MEASURED against this tree before being gated, not
# guessed. A rule with a false-positive rate becomes noise, gets whitelisted,
# and then gets ignored -- so a rule that cannot be made clean is left out
# rather than shipped loose.

# A generated LR parser's string table holds grammar symbol names and
# punctuation terminals. Multi-word keywords are real ("is not", "not in",
# "static get"), so a bare space is NOT a signal. Measured across all 159
# vendored grammars: 48,271 literals, 63 contain a space, and the longest
# legitimate one is three words ("hide empty description"). Prose needs more.
# Four is therefore the tightest threshold with zero false positives today, and
# it still catches a four-word instruction like "ignore all previous
# instructions".
PARSER_PROSE_WORDS = 4

# DEFERRED -- hiding constructs (`display:none`, `visibility:hidden`, HTML
# comments, `<script`) are NOT checked here, because measurement showed the
# rule cannot be made clean at tree scope. `<!--` and `<script` have 61
# legitimate uses across PR templates, docs and HTML-parsing tests, and
# `display:none` is ordinary styling in docs/index.html, the project website.
# The real concern is a hiding construct inside AGENT-FACING content, which is
# a location question rather than a pattern question -- it belongs with the
# Tier 3 location rule, once the set of places we deliberately instruct agents
# is enumerated. Shipping it loose here would produce a rule that needs
# excuses, and a rule that needs excuses gets switched off.

_LITERAL = re.compile(r'"((?:[^"\\\n]|\\.)*)"')


def tier2_findings(root):
    """Yield (path, line_no, detail) for prose smuggled into generated parsers."""
    for rel in tracked_files(root):
        full = root / rel
        is_parser = rel.startswith("internal/cbm/vendored/grammars/") and rel.endswith(
            "parser.c"
        )
        try:
            raw = full.read_bytes()
        except (OSError, ValueError):
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue

        if is_parser:
            for m in _LITERAL.finditer(text):
                lit = m.group(1)
                words = [w for w in lit.split(" ") if w]
                if len(words) >= PARSER_PROSE_WORDS:
                    line_no = text.count("\n", 0, m.start()) + 1
                    yield rel, line_no, (
                        f"generated parser holds a {len(words)}-word string "
                        f"literal (prose does not belong in a symbol table): "
                        f"{lit[:80]!r}"
                    )
            continue



def load_allowlist(root):
    """Return {(sha256, path): why}. Entries without a real why are dropped."""
    path = root / ALLOWLIST
    entries, malformed = {}, []
    if not path.exists():
        return entries, malformed
    for raw_no, raw in enumerate(path.read_text(encoding="utf-8").split("\n"), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        body, _, why = line.partition("#")
        parts = body.split()
        if len(parts) != 2:
            malformed.append((raw_no, "expected '<sha256>  <path>  # why'", line))
            continue
        digest, rel = parts
        if len(digest) != 64 or not all(c in "0123456789abcdef" for c in digest):
            malformed.append((raw_no, "first field is not a sha256", line))
            continue
        why = why.strip()
        if not why or PLACEHOLDER in why:
            malformed.append(
                (raw_no, "needs a written justification, not a placeholder", line)
            )
            continue
        entries[(digest, rel)] = why
    return entries, malformed


def render(ch):
    return f"U+{ord(ch):04X}"


def selftest():
    """Prove the gate catches what it claims and ignores what it must.

    A gate nobody has seen fail is indistinguishable from a gate that cannot
    fail, so this runs in CI beside the real scan.
    """
    failures = []

    def check(ok, what):
        if not ok:
            failures.append(what)

    # Every carrier class must be recognised.
    for cp, what in [
        (0x200B, "zero-width space"),
        (0x200E, "left-to-right mark"),
        (0x202E, "right-to-left override (Trojan Source)"),
        (0x2060, "word joiner"),
        (0x2066, "directional isolate"),
        (0xFEFF, "byte-order mark"),
        (0x00AD, "soft hyphen"),
        (0xE0001, "Unicode Tags block"),
        (0xE007F, "Unicode Tags block terminator"),
    ]:
        check(classify(cp) is not None, f"missed carrier {what} (U+{cp:04X})")

    # Legitimate non-ASCII that this repo genuinely contains must NOT trip it.
    # If any of these ever start failing the gate becomes noise and gets
    # switched off, which is worse than not having it.
    for cp, what in [
        (0x2014, "em dash (prose throughout)"),
        (0x2500, "box drawing (section banners)"),
        (0x2192, "rightwards arrow (comments)"),
        (0x4E2D, "CJK ideograph (i18n strings)"),
        (0x00E9, "e-acute (contributor names)"),
        (0x2713, "check mark"),
        (0x1F916, "emoji"),
    ]:
        check(classify(cp) is None, f"false positive on {what} (U+{cp:04X})")

    # A blessed line is pinned by content: changing it must invalidate the entry.
    line = 'x = "a\u200bb";'
    other = 'x = "a\u200bc";'
    check(
        hashlib.sha256(line.encode()).hexdigest()
        != hashlib.sha256(other.encode()).hexdigest(),
        "line hash did not change when the blessed line changed",
    )

    if failures:
        for f in failures:
            print(f"SELFTEST FAIL: {f}")
        return 1
    print(f"OK: selftest passed ({len(_CARRIER_LABEL)} carrier codepoints known).")
    return 0


def main(argv):
    if "--selftest" in argv:
        return selftest()

    update = "--update" in argv
    rest = [a for a in argv if not a.startswith("--")]
    root = Path(rest[0]).resolve() if rest else Path.cwd()

    allowed, malformed = load_allowlist(root)
    hits = list(scan(root))

    if update:
        lines = [
            "# Hidden-instruction allowlist -- see scripts/security-injection.py.",
            "# Each entry pins the sha256 of ONE line. Editing that line breaks the",
            "# entry and fails the gate, on purpose. Replace every TODO with a real",
            "# justification; the gate rejects placeholders.",
            "",
        ]
        for rel, line_no, _line, digest, found in hits:
            names = ", ".join(sorted({render(c) for c, _ in found}))
            lines.append(f"{digest}  {rel}  # TODO: why is {names} safe here?")
        (root / ALLOWLIST).write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"wrote {len(hits)} entries to {ALLOWLIST}")
        print("Each still needs a written justification before the gate will pass.")
        return 0

    problems = 0
    for raw_no, why, line in malformed:
        print(f"FAIL: {ALLOWLIST}:{raw_no}: {why}\n    {line}")
        problems += 1

    unexplained = []
    for rel, line_no, line, digest, found in hits:
        if (digest, rel) in allowed:
            continue
        unexplained.append((rel, line_no, line, digest, found))

    if unexplained:
        print("=== HIDDEN-INSTRUCTION AUDIT: REFUSED ===\n")
        for rel, line_no, line, digest, found in unexplained:
            names = ", ".join(f"{render(c)} ({lbl})" for c, lbl in found)
            shown = "".join(
                f"<{render(c)}>" if classify(ord(c)) else c for c in line
            ).strip()
            print(f"{rel}:{line_no}: {names}")
            print(f"    {shown}")
            print(f"    sha256 {digest}\n")
        print("These characters are invisible in an editor and in a diff, but a")
        print("model reading the file still consumes them.\n")
        print("PREFERRED FIX: rephrase so the character is not needed. An")
        print("allowlist entry is a permanent exception and should be rare.")
        print(f"If it is genuinely required, add to {ALLOWLIST}:\n")
        for rel, _n, _l, digest, _f in unexplained:
            print(f"    {digest}  {rel}  # <why this is safe>")
        problems += len(unexplained)

    for rel, line_no, detail in tier2_findings(root):
        if problems == 0:
            print("=== HIDDEN-INSTRUCTION AUDIT: REFUSED ===\n")
        print(f"{rel}:{line_no}: {detail}\n")
        problems += 1

    stale = set(allowed) - {(d, r) for r, _n, _l, d, _f in hits}
    for digest, rel in sorted(stale):
        print(f"FAIL: stale allowlist entry (line no longer present): {digest}  {rel}")
        problems += 1

    if problems:
        return 1
    print(f"OK: no hidden-instruction carriers outside the allowlist "
          f"({len(allowed)} allowed, {len(hits)} occurrence(s) total).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
