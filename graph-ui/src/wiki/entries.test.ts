import { describe, expect, it } from "vitest";
import { WIKI_ENTRIES, wikiEntry, wikiEntryById } from "./entries";

describe("wiki entries", () => {
  it("every sentence is present and tooltip-sized (≤30 words)", () => {
    for (const entry of WIKI_ENTRIES) {
      expect(entry.sentence.trim().length, entry.slug).toBeGreaterThan(0);
      expect(
        entry.sentence.trim().split(/\s+/).length,
        `${entry.slug} sentence exceeds 30 words`,
      ).toBeLessThanOrEqual(30);
    }
  });

  it("ids and slugs are unique", () => {
    const ids = WIKI_ENTRIES.map((entry) => entry.id);
    const slugs = WIKI_ENTRIES.map((entry) => entry.slug);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every non-refused entry names what it does not cover", () => {
    for (const entry of WIKI_ENTRIES) {
      if (entry.tier === "refused") continue;
      expect(entry.notCovered?.trim(), entry.slug).toBeTruthy();
    }
  });

  it("every pairedWith and seeAlso slug resolves to an existing entry", () => {
    for (const entry of WIKI_ENTRIES) {
      if (entry.pairedWith !== undefined) {
        expect(wikiEntry(entry.pairedWith), `${entry.slug} → ${entry.pairedWith}`).toBeDefined();
      }
      for (const other of entry.seeAlso ?? []) {
        expect(wikiEntry(other), `${entry.slug} → ${other}`).toBeDefined();
      }
    }
  });

  it("ids follow the M-… register format", () => {
    for (const entry of WIKI_ENTRIES) {
      expect(entry.id, entry.slug).toMatch(/^M-[A-Z-]+$/);
    }
  });

  it("lookup helpers resolve by slug and by id", () => {
    expect(wikiEntry("hotspot")?.id).toBe("M-HOTSPOT");
    expect(wikiEntryById("M-HOTSPOT")?.slug).toBe("hotspot");
    expect(wikiEntry("no-such-metric")).toBeUndefined();
    expect(wikiEntryById("M-NO-SUCH")).toBeUndefined();
  });
});
