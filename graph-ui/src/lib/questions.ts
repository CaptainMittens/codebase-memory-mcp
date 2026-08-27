/* The question index — Atlas's honest scorecard. Twenty years of
 * developer-information-needs research reduces to 18 question families;
 * this module says, per family, whether Atlas answers it, answers it
 * partially, or does not answer it yet. Honesty about the gaps is a
 * deliberate product feature — the wording is not softened.
 * The question/hint/gap strings stay English for now: content-i18n is a
 * separate queued pass (UI chrome around them is translated in i18n.ts). */
import type { TabId } from "./types";

export type QuestionStatus = "answers" | "partial" | "lacks";

/* Only the project tabs a question row can navigate to. */
export type QuestionTab = Extract<
  TabId,
  "overview" | "modules" | "graph" | "flows" | "changes" | "dashboard"
>;

export interface QuestionFamily {
  id: string;
  question: string;
  status: QuestionStatus;
  tab?: QuestionTab;
  /* Where to look / how to get there when a tab alone isn't enough. */
  hint?: string;
  /* What's missing — required for partial and lacks. */
  gap?: string;
}

export const QUESTION_FAMILIES: QuestionFamily[] = [
  {
    id: "F1",
    question: "Where is the code that does X?",
    status: "answers",
    tab: "graph",
    hint: "Galaxy + Modules + ⌘K search; scent shows where a term concentrates",
  },
  {
    id: "F2",
    question: "What calls this — and what does it call?",
    status: "answers",
    hint: "Open any symbol (⌘K) — callers and callees with resolution confidence",
  },
  {
    id: "F3",
    question: "If I change this, what breaks — and what must I retest?",
    status: "answers",
    tab: "changes",
    hint: "Changes tab for the current diff; every symbol page answers it hypothetically under 'If you change this'",
  },
  {
    id: "F4",
    question: "Is this dead? Can I remove it safely?",
    status: "partial",
    tab: "dashboard",
    gap: "Dead candidates list what has no recorded callers; the caveats you must check first are in the wiki entry",
  },
  {
    id: "F5",
    question: "What code caused this behavior?",
    status: "partial",
    tab: "flows",
    hint: "Flows tab — ▶ observed markers on trace hops and flow steps show what actually ran",
    gap: "Flows and traces now mark observed vs possible hops from ingested runtime traces; automatic trace capture and failure reproduction are not built",
  },
  {
    id: "F6",
    question: "When does this actually run, and under what conditions?",
    status: "answers",
    hint: "Open any symbol — the trigger tree shows guards, dispatch, and what it triggers",
  },
  {
    id: "F7",
    question: "Why was it built this way?",
    status: "partial",
    hint: "Symbol view: docs, ADR panel, file history, and 'Why is this here?' traces a symbol's own git history",
    gap: "Symbol-level history with linked commits and PR/issue refs is here; PR/issue titles and ADR-to-symbol links are not fetched or joined yet",
  },
  {
    id: "F8",
    question: "Did I follow this codebase's conventions?",
    status: "lacks",
    gap: "Conventions conformance is not derived yet — planned",
  },
  {
    id: "F9",
    question: "What tests cover this?",
    status: "partial",
    tab: "dashboard",
    hint: "Tested symbols card; per-symbol 'Tested by'",
    gap: "TESTS-edge reach is shown per symbol; change→test selection is planned",
  },
  {
    id: "F10",
    question: "Where is the risk — what should we fix first?",
    status: "answers",
    tab: "dashboard",
    hint: "Churn × complexity hero with the knee-based head and cost sentence",
  },
  {
    id: "F11",
    question: "What are the components — and are the boundaries respected?",
    status: "answers",
    tab: "overview",
    hint: "Regions, boundary spanners, unusually-coupled pairs",
  },
  {
    id: "F12",
    question: "What changed here, and what changes together with it?",
    status: "partial",
    hint: "Symbol view: file history and co-change",
    gap: "File-granular only; symbol-level evolution is not tracked",
  },
  {
    id: "F13",
    question: "Who knows this code — who should I ask?",
    status: "partial",
    hint: "Symbol view: file history authors",
    gap: "Top authors with evidence per file; a dedicated who-can-help view is planned — never a leaderboard",
  },
  {
    id: "F14",
    question: "Does this dependency upgrade reach my code — what breaks?",
    status: "lacks",
    gap: "External dependency reachability is not modelled yet — planned",
  },
  {
    id: "F15",
    question: "How do I use this API idiomatically?",
    status: "partial",
    hint: "Symbol view: snippets and near-clones",
    gap: "Deliberately not invested — LLMs answer idiom questions well; Atlas shows real call sites and near-clones instead",
  },
  {
    id: "F16",
    question: "Is this bug report legit — how hard is it to fix?",
    status: "partial",
    tab: "overview",
    hint: "Needs attention (Overview) + Changes risk",
    gap: "Needs-attention ranks code-side difficulty; there is no issue-tracker join",
  },
  {
    id: "F17",
    question: "What did the agent touch — and what did it not look at?",
    status: "lacks",
    gap: "Agent-diff provenance is not built yet — planned",
  },
  {
    id: "F18",
    question: "What do I hand my agent so it doesn't guess?",
    status: "answers",
    hint: "The Prompt composer collects cited evidence; flows copy as mermaid; the handout is one click",
  },
];

/* Derived, never hard-coded — the scorecard header counts itself. */
export function questionStatusCounts(
  families: QuestionFamily[],
): Record<QuestionStatus, number> {
  const counts: Record<QuestionStatus, number> = { answers: 0, partial: 0, lacks: 0 };
  for (const family of families) counts[family.status] += 1;
  return counts;
}
