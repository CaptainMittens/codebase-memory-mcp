#!/usr/bin/env bash
# Regression guard: this repo's own parse-coverage report must stay useful.
#
# A coverage range is advice — "these lines are missing from the graph, read
# them". Advice stops being advice when it names most of the file, and it
# stops being honest when the list was clipped without saying so. Both things
# happened here before (#963): src/cli/cli.c reported its whole 13,046 lines
# as one range, and two caps in series dropped ranges with no signal at all.
#
# This indexes the repo with a given binary and fails if any of that comes back.
#
# Usage: self-index-coverage-gate.sh <path-to-codebase-memory-mcp-binary>
#
# NOTE ON PLATFORM: the ranges depend on which conditional-compilation branches
# the preprocessor keeps. On a machine where _WIN32 is defined the discarded
# branches swap and a different set of lines is flagged. That is why this runs
# on ONE CI leg and asserts proportions rather than exact line numbers.
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: scripts/ci/self-index-coverage-gate.sh <path-to-codebase-memory-mcp-binary>

Index THIS repository with the given binary and fail if the repository's own
parse-coverage report stops being useful advice (#963).

Four checks, all read from index_status:
  1. No file reports a whole-file parse failure (parse_unusable).
  2. No range list was clipped without saying so (a trailing "+<N>" marker).
  3. No single range covers more than 25% of a file of 200 lines or more.
  4. The flagged-file count stays at or below the checked-in ceiling.

Data files, both beside this script:
  coverage-gate-allowlist.txt   paths the checks skip, each with a written
                                reason above it.
  parse-partial-baseline.txt    the ceiling for check 4.

Environment:
  MAX_SINGLE_RANGE_PCT   Share limit for check 3 (default 25).
  MIN_FILE_LINES         Files below this are exempt from check 3 (default 200).

Exit 0 when every check passes, 1 when any fails, 2 on a bad argument.

Options:
  -h, --help        This text.
EOF
}

BIN=""
while [ $# -gt 0 ]; do
    case "$1" in
    -h | --help) usage; exit 0 ;;
    -*) echo "self-index-coverage-gate: unknown argument '$1'. Please consult --help." >&2; exit 2 ;;
    *)
        [ -z "$BIN" ] || {
            echo "self-index-coverage-gate: one binary path only. Please consult --help." >&2
            exit 2
        }
        BIN="$1"
        ;;
    esac
    shift
done
[ -n "$BIN" ] || { echo "self-index-coverage-gate: need a binary path. Please consult --help." >&2; exit 2; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ALLOWLIST="${REPO_ROOT}/scripts/ci/coverage-gate-allowlist.txt"
BASELINE_FILE="${REPO_ROOT}/scripts/ci/parse-partial-baseline.txt"

# Share of a file one range may cover before it stops being useful advice.
# The worst real offender today is src/cli/cli.c at 3.9%, so this has room.
MAX_SINGLE_RANGE_PCT="${MAX_SINGLE_RANGE_PCT:-25}"
# Files below this are exempt: a 5-line fixture with a 3-line range is 60% of
# itself and says nothing about report quality.
MIN_FILE_LINES="${MIN_FILE_LINES:-200}"

command -v jq >/dev/null || { echo "FAIL: jq is required"; exit 1; }

WORK="$(mktemp -d)"
# The runtime dir holds a unix socket, and a socket path has a hard length
# limit (~104 bytes). macOS puts mktemp under /var/folders/<long>/T/, which
# blows that limit and fails with "secure CLI coordination could not be
# created (endpoint)". Keep the runtime dir short and separate from the cache.
RUNTIME="/tmp/cbm-gate.$$"
trap 'rm -rf "$WORK" "$RUNTIME"' EXIT
export CBM_CACHE_DIR="${WORK}/cache"
export CBM_RUNTIME_DIR="$RUNTIME"
mkdir -p "$CBM_CACHE_DIR" "$RUNTIME"

echo "==> indexing ${REPO_ROOT} with $(basename "$BIN")"
"$BIN" cli index_repository --repo-path "$REPO_ROOT" --mode full --json \
    > "${WORK}/index.json" 2>"${WORK}/index.err" || {
        echo "FAIL: index_repository exited non-zero"; tail -20 "${WORK}/index.err"; exit 1; }

PROJECT="$(jq -r '.structuredContent.project // empty' "${WORK}/index.json")"
[ -n "$PROJECT" ] || { echo "FAIL: index_repository did not name a project"; exit 1; }

"$BIN" cli index_status --project "$PROJECT" --json > "${WORK}/status.json" 2>/dev/null || {
        echo "FAIL: index_status exited non-zero"; exit 1; }

# Allowlisted paths, comments and blanks stripped.
ALLOWED="${WORK}/allowed.txt"
: > "$ALLOWED"
[ -f "$ALLOWLIST" ] && sed -e 's/#.*//' -e 's/[[:space:]]*$//' "$ALLOWLIST" \
    | grep -v '^$' > "$ALLOWED" || true

FAILURES=0
note_failure() { echo "FAIL: $*"; FAILURES=$((FAILURES + 1)); }

# ── 0. The report's own file list must be complete ────────────────────────
# index_status lists at most 500 files per class and sets "truncated" when it
# drops the rest. Checks 2 and 3 below read that list file by file, so a
# clipped list means they judge only part of the repo and still print PASS.
# That is the same silent clipping this gate exists to catch, so stop instead.
for cls in parse_partial parse_unusable; do
    clipped="$(jq -r --arg c "$cls" '.structuredContent[$c].truncated // false' "${WORK}/status.json")"
    if [ "$clipped" = "true" ]; then
        note_failure "index_status clipped its ${cls} file list — the checks below would see only part of it"
    fi
done

# ── 1. Nothing may fail across a whole file ────────────────────────────────
# parse_unusable means one range covers 80%+ of the file, so the report tells
# a reader to go read the source. Zero today; a new one is a real regression.
UNUSABLE_LISTED="$(jq -r '[.structuredContent.parse_unusable.files[]?.path]|join(" ")' \
    "${WORK}/status.json")"
UNUSABLE=0
UNUSABLE_KEPT=""
for p in $UNUSABLE_LISTED; do
    grep -qxF "$p" "$ALLOWED" && continue
    UNUSABLE=$((UNUSABLE + 1))
    UNUSABLE_KEPT="${UNUSABLE_KEPT}${p} "
done
if [ "$UNUSABLE" -gt 0 ]; then
    note_failure "${UNUSABLE} file(s) report a whole-file parse failure: ${UNUSABLE_KEPT}"
fi

# ── 2. No range list may be silently clipped ──────────────────────────────
# A trailing "+<N>" says the producer's cap threw N ranges away. With the cap
# at 256 a file that still overflows is worth stopping for.
TRUNCATED="$(jq -r '[.structuredContent.parse_partial.files[]?
    | select(.error_ranges? // "" | test("\\+[0-9]+$")) | .path] | join(" ")' \
    "${WORK}/status.json")"
for p in $TRUNCATED; do
    grep -qxF "$p" "$ALLOWED" && continue
    note_failure "$p carries a +N truncation marker — its range list was clipped"
done

# ── 3. No single range may cover a quarter of its file ────────────────────
while IFS=$'\t' read -r path ranges; do
    [ -n "$path" ] || continue
    grep -qxF "$path" "$ALLOWED" && continue
    [ -f "${REPO_ROOT}/${path}" ] || continue
    total="$(wc -l < "${REPO_ROOT}/${path}" | tr -d ' ')"
    [ "$total" -ge "$MIN_FILE_LINES" ] || continue
    widest="$(printf '%s' "$ranges" | tr ',' '\n' | grep '^[0-9]' \
        | awk -F- '{d=$2-$1+1; if (d>m) m=d} END {print m+0}')"
    pct="$(awk -v a="$widest" -v b="$total" 'BEGIN{printf "%.1f", 100*a/b}')"
    over="$(awk -v p="$pct" -v lim="$MAX_SINGLE_RANGE_PCT" 'BEGIN{print (p>lim)?1:0}')"
    if [ "$over" = "1" ]; then
        note_failure "$path has one range of ${widest} lines — ${pct}% of ${total}, over ${MAX_SINGLE_RANGE_PCT}%"
    fi
done < <(jq -r '.structuredContent.parse_partial.files[]?
    | "\(.path)\t\(.error_ranges // "")"' "${WORK}/status.json")

# ── 4. The flagged-file count must not drift upward unnoticed ─────────────
# One awk, not `grep | head -1`: under `set -o pipefail` head closes the pipe
# early, grep dies of SIGPIPE, and the whole gate aborts with no message. It
# does not bite on today's short file, and it would bite the day someone adds
# a few comment lines.
CEILING="$(awk '{ sub(/#.*/, "") } match($0, /[0-9]+/) { print substr($0, RSTART, RLENGTH); exit }' \
    "$BASELINE_FILE")"
PARTIAL="$(jq -r '.structuredContent.parse_partial.count // 0' "${WORK}/status.json")"
if [ "$PARTIAL" -gt "$CEILING" ]; then
    note_failure "parse_partial_count is ${PARTIAL}, above the ceiling ${CEILING} in $(basename "$BASELINE_FILE")"
fi

echo "==> parse_partial=${PARTIAL} (ceiling ${CEILING}) parse_unusable=${UNUSABLE} allowlisted=$(wc -l < "$ALLOWED" | tr -d ' ')"
if [ "$FAILURES" -gt 0 ]; then
    echo "FAIL: ${FAILURES} coverage-gate check(s) failed"
    exit 1
fi
echo "PASS: parse-coverage report is within bounds"
