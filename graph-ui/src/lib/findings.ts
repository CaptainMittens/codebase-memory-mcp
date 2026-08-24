/* Findings machinery: knee-point cutoffs, the cost sentence, and finding
 * dismissals — the difference between a dashboard and a number museum. */

/* Knee of a descending score list: the index AFTER which the largest
 * relative drop occurs — "the head that matters" (CodeScene's refusal to
 * show 5,000 items). Returns at least 1, at most values.length. */
export function kneeCount(values: number[]): number {
  if (values.length <= 1) return values.length;
  let bestIndex = 0;
  let bestRatio = 0;
  for (let i = 0; i < values.length - 1; i++) {
    const current = values[i];
    const next = values[i + 1];
    if (current <= 0) break;
    const ratio = (current - next) / current;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestIndex = i;
    }
  }
  return bestIndex + 1;
}

/* "9 files — 1.1% of the codebase, 34% of all commits this year." */
export function costSentence(
  headFiles: number,
  headCommits: number,
  totalFiles: number,
  totalCommits: number,
): string | null {
  if (headFiles <= 0 || totalFiles <= 0 || totalCommits <= 0) return null;
  const filesShare = ((headFiles / totalFiles) * 100).toFixed(1);
  const commitShare = ((headCommits / totalCommits) * 100).toFixed(0);
  return `${headFiles} file${headFiles > 1 ? "s" : ""} — ${filesShare}% of the codebase, ${commitShare}% of all commits this year`;
}

/* Dismissals: a finding stays dismissed until its magnitude changes bucket
 * (an order-of-magnitude jump resurfaces it — regression re-alerts). */
const DISMISS_KEY = "cbm-atlas-dismissed";

export function findingKey(kind: string, subject: string, magnitude: number): string {
  const bucket = magnitude > 0 ? Math.floor(Math.log10(magnitude)) : 0;
  return `${kind}:${subject}:${bucket}`;
}

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function isDismissed(key: string): boolean {
  return readDismissed().has(key);
}

export function dismiss(key: string): void {
  try {
    const set = readDismissed();
    set.add(key);
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...set]));
  } catch {
    /* private mode — dismissals just don't persist */
  }
}

export function undismissAll(): void {
  try {
    localStorage.removeItem(DISMISS_KEY);
  } catch {
    /* ignore */
  }
}
