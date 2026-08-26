import { describe, expect, it } from "vitest";
import { formatGuard, formatGuardChain, allUnguarded, type WhyEntry } from "./why";

describe("formatGuard", () => {
  it("renders if/unless, case, loop and catch guards as words", () => {
    expect(formatGuard({ kind: "if", cond: "mode > 2" })).toBe("when mode > 2");
    expect(formatGuard({ kind: "if", cond: "strict", negated: true })).toBe(
      "unless strict",
    );
    expect(formatGuard({ kind: "case", cond: "CBM_LANG_C" })).toBe("case CBM_LANG_C");
    expect(formatGuard({ kind: "loop", cond: "i < n" })).toBe("looping while i < n");
    expect(formatGuard({ kind: "loop" })).toBe("in a loop");
    expect(formatGuard({ kind: "catch" })).toBe("on error handling");
  });
  it("chains outermost-first with arrows", () => {
    expect(
      formatGuardChain([
        { kind: "if", cond: "mode > 2" },
        { kind: "if", cond: "strict" },
      ]),
    ).toBe("when mode > 2 → when strict");
  });
});

describe("allUnguarded", () => {
  const entry = (guards: WhyEntry["guards"], loop?: boolean): WhyEntry => ({
    id: 1,
    name: "f",
    guards,
    loop,
    more: 0,
  });
  it("is true only when no entry carries a guard or loop", () => {
    expect(allUnguarded([entry([])])).toBe(true);
    expect(allUnguarded([entry([{ kind: "if", cond: "x" }])])).toBe(false);
    expect(allUnguarded([entry([], true)])).toBe(false);
  });
});
