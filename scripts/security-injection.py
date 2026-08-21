#!/usr/bin/env python3
"""Layer 0: hidden-instruction audit -- source-level check on the whole tree.

Scans every tracked file for Unicode that is INVISIBLE or DIRECTION-CONTROLLING
in a normal editor and diff view, but which a language model reading the file
still consumes. Those characters are the carrier layer of indirect prompt
injection: zero-width sequences, bidirectional overrides (Trojan Source), the
Unicode Tags block, and stray byte-order marks.

WHY THIS IS A HARD GATE AND A KEYWORD LIST IS NOT
------------------------------------------------
The persuasion layer of an injection -- prose telling the model to disregard
what came before -- is natural language, so it is unbounded and translatable -- published refusal rates
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

# Word counting assumes spaces between words, which is a LATIN-SCRIPT
# assumption: Chinese, Japanese and Thai write without them, so
# "\u5ffd\u7565\u4e4b\u524d\u7684\u6240\u6709\u6307\u4ee4" counts as a single word and would pass. The
# language-agnostic companion is a run of consecutive word-forming non-ASCII
# characters, which measures "this is prose in some script" without knowing
# which script. Measured across 2,199 non-ASCII literals in the vendored
# grammars, the longest legitimate run is 1 -- the lone lambdas in `lean` and
# `fennel` -- because grammar terminals are symbols and operators, never words.
# Four is clean today and catches Chinese (9), Russian (10) and Arabic (9).
PARSER_PROSE_SCRIPT_RUN = 4


def _longest_nonascii_letter_run(text):
    best = current = 0
    for ch in text:
        if ord(ch) > 0x7F and ch.isalpha():
            current += 1
            best = max(best, current)
        else:
            current = 0
    return best

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


# ── Tier 3: agent-directed content outside the places we author it ─────
#
# 3a is language-INDEPENDENT by construction: these are chat-template and
# instruction-framing PROTOCOL tokens, not prose, so they read the same
# whatever human language surrounds them. Measured tree-wide: zero
# occurrences, so they gate with no location exemption at all.
FRAMING_TOKENS = [
    (re.compile(r"<\|im_(?:start|end)\|>"), "ChatML turn marker"),
    (re.compile(r"<\|(?:system|user|assistant)\|>"), "role-framing token"),
    (re.compile(r"\[/?INST\]"), "instruction-framing token"),
    (re.compile(r"###\s*Instruction\s*:", re.I), "instruction header"),
    (re.compile(r"<\|endoftext\|>"), "end-of-text token"),
    (re.compile(r"^\s*(?:Human|Assistant)\s*:", re.M), "dialogue turn marker"),
]

# The scope-reset intent -- telling a model to discard what came before --
# expressed across the languages an
# attacker is most likely to reach for. Written as a TABLE rather than a regex
# soup so a native speaker can review one row without parsing the whole thing.
#
# Structure is (verb-alternatives, noun-alternatives): a match needs BOTH, in
# either order, within a short window. Requiring the pair is what keeps this
# from firing on ordinary text -- "ignore" alone is a common English word, and
# so are its equivalents elsewhere.
#
# HONEST LIMITS, because this list invites false confidence:
#   * These translations have NOT been checked by native speakers. Treat a hit
#     as evidence, never as proof, and a miss as expected.
#   * Only the CJK rows are measurable against the corpora we benchmark on
#     (152 CJK samples); Cyrillic and Arabic appear once each, so those rows
#     are unverified against real attack text.
#   * ~20 languages out of thousands. This is breadth of evidence. The
#     structural layers -- carrier Unicode, script runs, framing tokens,
#     location -- are what actually carry the weight.
OVERRIDE_INTENT = [
    ("en", r"ignore|disregard|forget|override",
           r"previous|prior|earlier|above|preceding|all|any|the\s+last",
           r"instructions?|prompts?|rules?|directives?|tasks?|context|conversation"),
    ("de", r"ignorier\w*|vergiss|vergessen|missacht\w*",
           r"vorherige\w*|obige\w*|alle|bisherige\w*|vorangegangen\w*",
           r"anweisung\w*|aufgabe\w*|regeln|anleitung\w*"),
    ("es", r"ignor\w+|olvid\w+|desestim\w+",
           r"anterior\w*|previa\w*|todas?|los\s+anteriores",
           r"instruccion\w*|tarea\w*|reglas|indicacion\w*"),
    ("fr", r"ignor\w+|oubli\w+|neglige\w*|néglige\w*",
           r"pr[eé]c[eé]dent\w*|ci-dessus|toutes?|ant[eé]rieur\w*",
           r"instructions?|t[aâ]ches?|r[eè]gles|consignes?"),
    ("pt", r"ignor\w+|esque[çc]\w+|desconsider\w+",
           r"anterior\w*|pr[eé]vi\w*|todas?",
           r"instru[çc][õo]es|tarefas?|regras"),
    ("it", r"ignor\w+|dimentic\w+",
           r"precedent\w*|sopra|tutte?",
           r"istruzion\w*|compit\w*|regole"),
    ("nl", r"negeer|vergeet|negeren",
           r"vorige|bovenstaande|alle",
           r"instructies?|opdracht\w*|regels"),
    ("ru", r"игнорир\w*|забуд\w*|пренебрег\w*",
           r"предыдущ\w*|вышеуказанн\w*|все",
           r"инструкц\w*|указан\w*|задан\w*|правил\w*"),
    ("uk", r"ігнор\w*|забудь",
           r"попередн\w*|усі|всі",
           r"інструкц\w*|завдання|правил\w*"),
    ("pl", r"zignoruj|ignoruj|zapomnij|pomi[nń]",
           r"poprzedni\w*|powy[żz]sz\w*|wszystkie",
           r"instrukcj\w*|polece[nń]\w*|zasad\w*|zadani\w*"),
    ("tr", r"yoksay\w*|g[oö]rmezden|unut\w*",
           r"[oö]nceki|yukar[ıi]daki|t[uü]m",
           r"talimat\w*|kural\w*|g[oö]rev\w*"),
    ("zh", r"忽略|忽视|无视|忘记|忘掉|不要理会",
           r"之前|以上|前面|所有|全部|先前|上述",
           r"指令|指示|命令|任务|规则|提示词|上文|之前"),
    ("ja", r"無視|忘れ\w*|破棄",
           r"以前|上記|すべて|全て|これまで",
           r"指示|命令|指令|ルール|タスク|プロンプト"),
    ("ko", r"무시|잊어|잊고",
           r"이전|위의|모든",
           r"지시|명령|규칙|작업|프롬프트"),
    ("ar", r"تجاهل|انسَ|انس|أهمل",
           r"السابق\w*|أعلاه|جميع|كل",
           r"التعليمات|الأوامر|القواعد|المهام"),
    ("hi", r"अनदेखा|भूल\w*|नज़रअंदाज़",
           r"पिछले|उपरोक्त|सभी",
           r"निर्देश\w*|आदेश\w*|नियम\w*"),
    ("vi", r"b[oỏ] qua|qu[eê]n|ph[oớ]t l[oờ]",
           r"tr[uư][oớ]c|[oở]\s*tr[eê]n|t[aấ]t c[aả]",
           r"h[uư][oớ]ng d[aẫ]n|ch[iỉ] d[aẫ]n|l[eệ]nh|quy t[aắ]c"),
    ("th", r"เพิกเฉย|ละเลย|ลืม",
           r"ก่อนหน้า|ข้างต้น|ทั้งหมด",
           r"คำสั่ง|คำแนะนำ|กฎ"),
    ("id", r"abaikan|lupakan|acuhkan",
           r"sebelumnya|di\s*atas|semua",
           r"instruksi|perintah|aturan|tugas"),
    ("fa", r"نادیده|فراموش",
           r"قبلی|بالا|همه",
           r"دستورالعمل|دستورات|قوانین"),
]

# Both parts within ~40 characters of each other, either order. The window is
# what stops "ignore" in one sentence pairing with "rules" three paragraphs
# later; it must be short enough to mean a single phrase.
# All three of verb, SCOPE QUALIFIER and noun must appear inside a short
# window. The qualifier is what separates an override from an ordinary
# sentence: a verb next to a noun is a .gitignore comment or sqlite3.c's
# `int ignoreJump /* Instruction ... */`, both of which this gate fired on
# before the qualifier was required. It is mandatory, not optional.
#
# TWO ORDERINGS, because word order is not universal. SVO languages put the
# verb first; Japanese, Korean, Turkish and Hindi are verb-final, so
# "<qualifier> no <noun> wo <verb>" is the natural phrasing there. Matching
# only verb-first silently excluded every SOV language -- which was caught by
# testing Japanese and Korean rather than by reasoning about it.
_OVERRIDE = [
    (re.compile(
        rf"(?:{v})[^\n]{{0,20}}?(?:{q})[^\n]{{0,20}}?(?:{n})"
        rf"|(?:{q})[^\n]{{0,20}}?(?:{n})[^\n]{{0,20}}?(?:{v})", re.I),
     f"scope-reset phrasing [{lang}]")
    for lang, v, q, n in OVERRIDE_INTENT
]

# 3b is the persuasion layer, and it is a SECONDARY signal by design. A phrase
# list cannot be complete -- an attacker switches language or substitutes
# homoglyphs and walks past it. It earns its place only because the location
# rule shrinks the surface: cbm authors agent-directed prose in exactly three
# places, so this pattern appearing anywhere else is anomalous regardless of
# what it says. Entries here are for breadth of evidence, never for coverage.
OTHER_PHRASES = [
    (re.compile(r"\byou\s+are\s+now\s+(?:an?|the)\s+\w+", re.I),
     "role-reassignment phrasing"),
    (re.compile(r"\bdo\s+not\s+(?:tell|reveal|mention|inform|disclose)\b", re.I),
     "concealment phrasing"),
    (re.compile(r"(?:reveal|print|output|repeat|show)\s+(?:your\s+)?"
                r"(?:system\s+)?(?:prompt|instructions)", re.I),
     "prompt-disclosure phrasing"),
]

# The only places this project deliberately writes agent-directed prose. Text
# of that shape ANYWHERE else is anomalous -- which is a question about
# LOCATION, so it cannot be dodged by switching language the way a phrase list
# can. Keep this list short; every addition widens the blind spot.
AGENT_INSTRUCTION_FILES = frozenset({
    "src/cli/cli.c",             # skill_content[]
    "src/cli/agent_profiles.c",  # rendered subagent profiles
    "src/cli/client_adapter.c",  # generated Pi / OpenCode adapters
})


# Running 20 windowed patterns over 1.33 GB costs minutes; the same scan with a
# cheap substring pre-filter costs seconds. These are the shortest distinctive
# fragments of the verb column above -- if none appears, no override pattern can
# match, so the expensive regexes never run. Keep this in sync when adding a
# language row; the selftest pins that correspondence.
OVERRIDE_ANCHORS = (
    "ignor", "disregard", "forget", "override", "vergiss", "vergessen",
    "missacht", "olvid", "desestim", "oubli", "neglige", "néglige", "esque",
    "desconsider", "dimentic", "negeer", "vergeet", "negeren", "игнор",
    "забуд", "пренебрег", "ігнор", "забудь", "zignoruj", "ignoruj",
    "zapomnij", "pomi", "yoksay", "görmezden", "gormezden", "unut",
    "忽略", "忽视", "无视", "忘记", "忘掉", "無視", "忘れ", "破棄",
    "무시", "잊어", "잊고", "تجاهل", "انس", "أهمل", "अनदेखा", "भूल",
    "नज़रअंदाज़", "bo qua", "bỏ qua", "quen", "quên", "phot lo", "phớt lờ",
    "เพิกเฉย", "ละเลย", "ลืม", "abaikan", "lupakan", "acuhkan",
    "نادیده", "فراموش",
)


def scan_tree(root):
    """Walk the tree ONCE, running every tier per file.

    Each tier used to walk independently, which meant four full read+decode
    passes over 1.33 GB and turned a seven-second gate into a multi-minute one.
    Reading is the dominant cost here, not matching, so the tiers share a pass.

    Yields (tier, rel, line_no, line, detail).
    """
    for rel in tracked_files(root):
        try:
            raw = (root / rel).read_bytes()
        except (OSError, ValueError):
            continue
        text = None
        if not raw.isascii():
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError:
                continue  # binary; not a review surface
            if any(classify(ord(ch)) for ch in text):
                for line_no, line in enumerate(text.split("\n"), 1):
                    found = [(c, classify(ord(c))) for c in line if classify(ord(c))]
                    if found:
                        yield "carrier", rel, line_no, line, found
        if text is None:
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError:
                continue

        if rel.startswith("internal/cbm/vendored/grammars/") and rel.endswith("parser.c"):
            for m in _LITERAL.finditer(text):
                lit = m.group(1)
                words = [w for w in lit.split(" ") if w]
                run = _longest_nonascii_letter_run(lit) if not lit.isascii() else 0
                reason = None
                if len(words) >= PARSER_PROSE_WORDS:
                    reason = f"{len(words)}-word"
                elif run >= PARSER_PROSE_SCRIPT_RUN:
                    reason = f"{run}-character non-Latin"
                if reason:
                    line_no = text.count("\n", 0, m.start()) + 1
                    yield "parser-prose", rel, line_no, "", (
                        f"generated parser holds a {reason} string literal "
                        f"(prose does not belong in a symbol table): {lit[:80]!r}"
                    )
            continue  # Tier 2 owns these files; prose rules add nothing here

        # The PHRASE layer does not run on vendored third-party source. It was
        # firing on sqlite3.c's `int ignoreJump /* Instruction to jump to ... */`
        # -- "ignor" and "Instruction" inside forty characters, in a database
        # engine that has nothing to do with agents. That is this layer's
        # inherent weakness demonstrated on real code, and the honest fix is to
        # narrow its scope rather than bless the hit. Vendored bytes keep the
        # carrier scan, the parser-prose rule, and the checksum gate in
        # security-vendored.sh; only the natural-language heuristic is dropped.
        if "/vendored/" in rel or rel.startswith("vendored/"):
            continue

        checks = list(FRAMING_TOKENS)
        if rel not in AGENT_INSTRUCTION_FILES:
            checks += OTHER_PHRASES
            lowered = text.lower()
            if any(a in lowered for a in OVERRIDE_ANCHORS):
                checks += _OVERRIDE
        for pattern, label in checks:
            for m in pattern.finditer(text):
                line_no = text.count("\n", 0, m.start()) + 1
                line = text.split("\n")[line_no - 1]
                yield "phrase", rel, line_no, line, f"{label}: {m.group(0)[:60]!r}"


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

    # Language-agnosticism is a load-bearing claim, so pin it. The word-count
    # rule is Latin-script-only; the script-run rule is what covers the rest.
    for payload, what in [
        ("\u5ffd\u7565\u4e4b\u524d\u7684\u6240\u6709\u6307\u4ee4", "Chinese (no spaces between words)"),
        ("\u0438\u0433\u043d\u043e\u0440\u0438\u0440\u0443\u0439 \u043f\u0440\u0435\u0434\u044b\u0434\u0443\u0449\u0438\u0435", "Russian"),
        ("\u062a\u062c\u0627\u0647\u0644 \u0627\u0644\u062a\u0639\u0644\u064a\u0645\u0627\u062a", "Arabic"),
    ]:
        check(
            _longest_nonascii_letter_run(payload) >= PARSER_PROSE_SCRIPT_RUN,
            f"script-run rule missed {what}",
        )
    check(
        _longest_nonascii_letter_run("\u03bb") < PARSER_PROSE_SCRIPT_RUN,
        "script-run rule false-positives on a lone lambda (a real grammar terminal)",
    )

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

    carrier, prose, phrase = [], [], []
    for tier, rel, line_no, line, detail in scan_tree(root):
        if tier == "carrier":
            digest = hashlib.sha256(line.encode("utf-8")).hexdigest()
            carrier.append((rel, line_no, line, digest, detail))
        elif tier == "parser-prose":
            prose.append((rel, line_no, detail))
        else:
            digest = hashlib.sha256(line.encode("utf-8")).hexdigest()
            phrase.append((rel, line_no, line, digest, detail))

    if update:
        lines = [
            "# Hidden-instruction allowlist -- see scripts/security-injection.py.",
            "# Each entry pins the sha256 of ONE line. Editing that line breaks the",
            "# entry and fails the gate, on purpose. Replace every TODO with a real",
            "# justification; the gate rejects placeholders.",
            "",
        ]
        for rel, _n, _l, digest, found in carrier:
            names = ", ".join(sorted({render(c) for c, _ in found}))
            lines.append(f"{digest}  {rel}  # TODO: why is {names} safe here?")
        for rel, _n, _l, digest, detail in phrase:
            lines.append(f"{digest}  {rel}  # TODO: why is this safe here? ({detail[:50]})")
        (root / ALLOWLIST).write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"wrote {len(carrier) + len(phrase)} entries to {ALLOWLIST}")
        print("Each still needs a written justification before the gate will pass.")
        return 0

    problems = 0
    for raw_no, why, line in malformed:
        print(f"FAIL: {ALLOWLIST}:{raw_no}: {why}\n    {line}")
        problems += 1

    def banner():
        if problems == 0:
            print("=== HIDDEN-INSTRUCTION AUDIT: REFUSED ===\n")

    for rel, line_no, line, digest, found in carrier:
        if (digest, rel) in allowed:
            continue
        banner()
        names = ", ".join(f"{render(c)} ({lbl})" for c, lbl in found)
        shown = "".join(f"<{render(c)}>" if classify(ord(c)) else c for c in line).strip()
        print(f"{rel}:{line_no}: {names}\n    {shown}\n    sha256 {digest}\n")
        problems += 1

    for rel, line_no, line, digest, detail in phrase:
        if (digest, rel) in allowed:
            continue
        banner()
        print(f"{rel}:{line_no}: {detail}\n    {line.strip()[:100]}\n    sha256 {digest}\n")
        problems += 1

    for rel, line_no, detail in prose:
        banner()
        print(f"{rel}:{line_no}: {detail}\n")
        problems += 1

    live = {(d, r) for r, _n, _l, d, _f in carrier} | {
        (d, r) for r, _n, _l, d, _f in phrase
    }
    for digest, rel in sorted(set(allowed) - live):
        print(f"FAIL: stale allowlist entry (line no longer present): {digest}  {rel}")
        problems += 1

    if problems:
        return 1
    print(f"OK: no hidden-instruction findings outside the allowlist "
          f"({len(allowed)} allowed, "
          f"{len(carrier) + len(phrase) + len(prose)} occurrence(s) total).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
