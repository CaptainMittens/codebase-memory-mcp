import { describe, expect, it } from "vitest";
import {
  CPLX_BINS,
  CPLX_SIMPLE_MAX,
  CPLX_TAIL_MIN,
  CPLX_TAIL_START,
  complexityTakeaway,
} from "./complexity";

/* Parse a bin label back into its bounds so the text the user reads under
 * the bars cannot drift from the numeric metadata the sentence derives
 * from. "1" → [1,1], "2–5" → [2,5], ">50" → [51,∞]. */
function parseLabel(label: string): { lo: number; hi: number } {
  if (label.startsWith(">")) return { lo: Number(label.slice(1)) + 1, hi: Infinity };
  const parts = label.split("–").map(Number);
  const lo = parts[0];
  const hi = parts.length > 1 ? parts[1] : parts[0];
  expect(Number.isFinite(lo)).toBe(true);
  expect(Number.isFinite(hi)).toBe(true);
  return { lo, hi };
}

describe("complexity bins", () => {
  it("labels agree with the numeric bounds and are contiguous", () => {
    let expectedLo = 1;
    for (const bin of CPLX_BINS) {
      const parsed = parseLabel(bin.label);
      expect(parsed.lo).toBe(expectedLo);
      expect(parsed.hi).toBe(bin.hi);
      expectedLo = bin.hi + 1;
    }
  });
  it("derived thresholds match the labels the user sees", () => {
    expect(CPLX_SIMPLE_MAX).toBe(parseLabel(CPLX_BINS[1].label).hi);
    expect(CPLX_TAIL_MIN).toBe(parseLabel(CPLX_BINS[CPLX_TAIL_START].label).lo - 1);
  });
});

describe("complexityTakeaway", () => {
  it("claims exactly what the labels claim", () => {
    const hist = [4, 6, 3, 2, 1, 1];
    const sentence = complexityTakeaway(hist, [])!;
    /* Recount from the label-parsed bounds, independent of the metadata. */
    const simple = hist
      .filter((_, index) => parseLabel(CPLX_BINS[index].label).hi <= CPLX_SIMPLE_MAX)
      .reduce((a, b) => a + b, 0);
    const tail = hist
      .filter((_, index) => parseLabel(CPLX_BINS[index].label).lo > CPLX_TAIL_MIN)
      .reduce((a, b) => a + b, 0);
    const total = hist.reduce((a, b) => a + b, 0);
    expect(sentence).toBe(
      `${((simple / total) * 100).toFixed(0)}% of functions are simple (≤${CPLX_SIMPLE_MAX}); ${tail} exceed ${CPLX_TAIL_MIN}.`,
    );
  });
  it("appends the leading names when given", () => {
    expect(complexityTakeaway([10, 0, 0, 0, 0, 2], ["a", "b"])).toContain("— led by a, b");
  });
  it("returns null on an empty population", () => {
    expect(complexityTakeaway([0, 0, 0, 0, 0, 0], [])).toBeNull();
  });
});
