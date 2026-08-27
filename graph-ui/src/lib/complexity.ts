/* Complexity bins — the single source of truth for the dashboard's
 * histogram labels and the takeaway sentence. The sentence's bin claims
 * ("simple (≤5)", "exceed 20") derive from this table, and a test binds
 * label text to the numeric bounds, so a label edit cannot silently lie. */

export interface CplxBin {
  label: string;
  /* Inclusive upper bound; Infinity for the open tail bin. */
  hi: number;
}

export const CPLX_BINS: CplxBin[] = [
  { label: "1", hi: 1 },
  { label: "2–5", hi: 5 },
  { label: "6–10", hi: 10 },
  { label: "11–20", hi: 20 },
  { label: "21–50", hi: 50 },
  { label: ">50", hi: Infinity },
];

/* The takeaway's two claims: "simple" = the first two bins, the flagged
 * tail = the last two. Both thresholds are read off the table. */
export const CPLX_SIMPLE_MAX = CPLX_BINS[1].hi;
export const CPLX_TAIL_START = CPLX_BINS.length - 2;
export const CPLX_TAIL_MIN = CPLX_BINS[CPLX_TAIL_START - 1].hi;

export function complexityTakeaway(hist: number[], names: string[]): string | null {
  const total = hist.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const simple = hist
    .filter((_, index) => CPLX_BINS[index] && CPLX_BINS[index].hi <= CPLX_SIMPLE_MAX)
    .reduce((a, b) => a + b, 0);
  const tail = hist
    .filter((_, index) => index >= CPLX_TAIL_START)
    .reduce((a, b) => a + b, 0);
  const led = names.filter(Boolean).join(", ");
  return `${((simple / total) * 100).toFixed(0)}% of functions are simple (≤${CPLX_SIMPLE_MAX}); ${tail.toLocaleString("en-US")} exceed ${CPLX_TAIL_MIN}${led ? ` — led by ${led}` : ""}.`;
}
