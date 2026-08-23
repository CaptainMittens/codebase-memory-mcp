/* The "first read": deterministic teaching artifacts computed from data the
 * graph already holds — every insight carries the reason it is interesting.
 * No model, no scores without provenance. */
import type { Region, RegionsPayload } from "./types";
import { disambiguateRegionNames } from "./regions";

export interface SurprisingCoupling {
  source: Region;
  target: Region;
  weight: number;
  reasons: string[];
}

/* Cross-region couplings ranked by an explained score: heavier links, links
 * that cross top-level directories, and links touching a low-cohesion region
 * rank higher. `misc` never surprises anyone. */
export function surprisingCouplings(
  payload: RegionsPayload,
  limit = 5,
): SurprisingCoupling[] {
  const regions = disambiguateRegionNames(payload.regions);
  const byId = new Map(regions.map((region) => [region.id, region]));
  const top = (name: string) => name.split("/")[0] ?? name;
  const scored: (SurprisingCoupling & { score: number })[] = [];
  for (const edge of payload.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    if (source.name === "misc" || target.name === "misc") continue;
    const reasons: string[] = [];
    let score = Math.log2(1 + edge.weight);
    reasons.push(`${edge.weight.toLocaleString("en-US")} edges cross the boundary`);
    if (top(source.name) !== top(target.name)) {
      score += 2;
      reasons.push(
        `links ${top(source.name)}/ to ${top(target.name)}/ — different top-level areas`,
      );
    }
    if (source.cohesion < 0.3 || target.cohesion < 0.3) {
      score += 1;
      const loose = source.cohesion < target.cohesion ? source : target;
      reasons.push(
        `${loose.name} holds together loosely (cohesion ${loose.cohesion.toFixed(2)})`,
      );
    }
    scored.push({ source, target, weight: edge.weight, reasons, score });
  }
  scored.sort(
    (a, b) => b.score - a.score || b.weight - a.weight || a.source.id - b.source.id,
  );
  return scored.slice(0, limit).map(({ score: _score, ...rest }) => rest);
}

export interface SuggestedQuestion {
  question: string;
  why: string;
  /* Seed for the prompt composer: the entities the question is about. */
  about: string[];
}

export interface FirstReadStats {
  deadCount?: number;
  unresolvedShare?: number; /* USAGE / (CALLS+CALL_REFERENCE+USAGE), 0..1 */
}

/* Question templates keyed to structural signals — each one is a prompt
 * starter the human can hand to their agent. */
export function suggestedQuestions(
  payload: RegionsPayload,
  stats: FirstReadStats = {},
  limit = 5,
): SuggestedQuestion[] {
  const regions = disambiguateRegionNames(payload.regions).filter(
    (region) => region.name !== "misc",
  );
  const questions: SuggestedQuestion[] = [];

  const couplings = surprisingCouplings(payload, 2);
  for (const coupling of couplings) {
    questions.push({
      question: `Why does ${coupling.source.name} depend on ${coupling.target.name}?`,
      why: coupling.reasons.join("; "),
      about: [coupling.source.name, coupling.target.name],
    });
  }

  const loose = [...regions]
    .filter((region) => region.members >= 50 && region.cohesion > 0 && region.cohesion < 0.25)
    .sort((a, b) => a.cohesion - b.cohesion)[0];
  if (loose) {
    questions.push({
      question: `Should ${loose.name} be split into smaller modules?`,
      why: `only ${(loose.cohesion * 100).toFixed(0)}% of its edges stay inside the region (${loose.members.toLocaleString("en-US")} symbols)`,
      about: [loose.name],
    });
  }

  if (stats.deadCount && stats.deadCount > 0) {
    questions.push({
      question: `Are the ${stats.deadCount.toLocaleString("en-US")} functions with no callers safe to delete?`,
      why: "zero CALLS and zero USAGE reach them, excluding entry points and tests",
      about: ["dead code"],
    });
  }

  if (stats.unresolvedShare !== undefined && stats.unresolvedShare > 0.3) {
    questions.push({
      question: "Which call sites does the graph fail to resolve, and why?",
      why: `${(stats.unresolvedShare * 100).toFixed(0)}% of call-ish edges are USAGE (no proven single target)`,
      about: ["resolution certainty"],
    });
  }

  return questions.slice(0, limit);
}
