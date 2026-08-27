/* The metric wiki — every number Atlas shows, explained in one place: what
 * it means (one tooltip-sized sentence), why it earns its spot, how it is
 * computed, the named caps, and what it deliberately does not cover. The
 * "refused" tier documents metrics Atlas will NOT show, and why. This file
 * is the single source of truth; panels and chips render from it. */

export type WikiTier = "first-class" | "caveated" | "refused";

export interface WikiEntry {
  id: string;
  slug: string;
  term: string;
  tier: WikiTier;
  /* ≤30 words — this IS the tooltip text. */
  sentence: string;
  why?: string;
  computedParts?: string[];
  /* Named caps, each "capped: … because …" style — rendered as warnings. */
  caps?: string[];
  notCovered?: string;
  appearsIn: string[];
  pairedWith?: string;
  seeAlso?: string[];
}

export const WIKI_ENTRIES: WikiEntry[] = [
  {
    id: "M-CHURN",
    slug: "churn",
    term: "churn",
    tier: "first-class",
    sentence:
      "How often this file changed in the last year — the strongest single predictor of where work concentrates.",
    why: "Where code changed last year is where it will change next — and every change is a chance to break something. Process history predicts defects better than any measure of the code itself.",
    caps: ["vendored and generated paths are excluded"],
    notCovered:
      "Raw commit counts, not size-adjusted; relative churn (per size) is the variant with peer-reviewed defect-prediction backing and is planned as the default axis.",
    appearsIn: ["Dashboard", "Symbol file history", "Handout"],
    pairedWith: "complexity",
  },
  {
    id: "M-COCHANGE",
    slug: "co-change",
    term: "co-change",
    tier: "first-class",
    sentence:
      "Files that tend to change in the same commits as this one — coupling as history actually happened, not as imports suggest.",
    why: "If two files always change together, they are one module the directory tree forgot. Editing one without its partner is a classic source of half-done changes.",
    notCovered:
      "Pairs below the minimum co-commit support are not shown; the observation window is stated on the panel.",
    appearsIn: ["Symbol"],
    pairedWith: "coupling",
  },
  {
    id: "M-FANIN",
    slug: "fan",
    term: "fan",
    tier: "first-class",
    sentence:
      "How many symbols call this one (fan-in), and how many it calls (fan-out) — the raw material of blast radius.",
    why: "High fan-in means many places notice when this breaks; high fan-out means this breaks when many places change. Both ends deserve tests and careful review.",
    notCovered:
      "Edges carry resolution confidence; unresolved dynamic calls are not counted.",
    appearsIn: ["Symbol", "Galaxy"],
    seeAlso: ["confidence", "blast-radius"],
  },
  {
    id: "M-HOTSPOT",
    slug: "hotspot",
    term: "hotspot",
    tier: "first-class",
    sentence:
      "Files that change often and are hard to follow — where fixes cluster and edits cost the most.",
    why: "A small set of hotspots typically carries a large share of defect-fixing work. Relative churn predicts defect density; raw line counts don't. Effort spent here beats effort spread evenly.",
    computedParts: [
      "churn percentile of this repo",
      "complexity percentile of this repo",
    ],
    caps: [
      "capped: files under 100 lines are excluded — too small to rank",
      "capped: test files are excluded",
    ],
    notCovered:
      "Bug density is not measured directly — there is no issue-tracker join yet. Generated or vendored files can inflate churn. A stable-but-tangled file with no recent commits won't appear here; see complexity alone for those.",
    appearsIn: ["Dashboard hero", "Changes risk", "Handout"],
    pairedWith: "tested",
    seeAlso: ["churn", "complexity"],
  },
  {
    id: "M-CPLX",
    slug: "complexity",
    term: "complexity",
    tier: "caveated",
    sentence:
      "The number of independent paths through a function — a decent proxy for hard-to-test, a weak one for hard-to-read.",
    why: "Every independent path is a case a test must cover and a reader must simulate. High-percentile functions in this repository are where reviews slow down and tests multiply.",
    notCovered:
      "Cyclomatic complexity correlates heavily with size; the percentile shown is of this repository, never an absolute good/bad threshold.",
    appearsIn: ["Dashboard", "Symbol"],
    pairedWith: "churn",
    seeAlso: ["cognitive-complexity"],
  },
  {
    id: "M-COG",
    slug: "cognitive-complexity",
    term: "cognitive complexity",
    tier: "caveated",
    sentence:
      "How much nesting and control-flow interruption a reader must hold in their head to follow this function.",
    why: "Deep nesting forces a reader to keep every enclosing condition in working memory. This measure was designed to match how hard code feels to read, and tracks that better than path counting.",
    notCovered:
      "Better matched to perceived readability than cyclomatic, but still size-confounded.",
    appearsIn: ["Dashboard", "Symbol"],
    seeAlso: ["complexity"],
  },
  {
    id: "M-COH",
    slug: "cohesion",
    term: "cohesion",
    tier: "caveated",
    sentence:
      "How much this region's files actually work together, measured by internal connections.",
    why: "A region whose files barely talk to each other is a folder, not a module — changes ripple outward instead of staying local. Read it beside coupling: shredding a module improves one at the cost of the other.",
    notCovered:
      "Structural cohesion measures failed empirical validation as quality predictors; a history-based co-change cohesion is the planned replacement. Always read beside coupling.",
    appearsIn: ["Overview regions", "Modules"],
    pairedWith: "coupling",
  },
  {
    id: "M-COUP",
    slug: "coupling",
    term: "coupling",
    tier: "first-class",
    sentence:
      "How strongly two regions depend on each other, counted in cross-region calls.",
    why: "The more two regions call each other, the harder they are to change, test, or understand apart. Heavy coupling between supposedly separate modules is the map's most actionable warning.",
    notCovered: "Only statically resolved calls are counted; confidence applies.",
    appearsIn: ["Overview", "Modules"],
    pairedWith: "cohesion",
  },
  {
    id: "M-BRIDGE",
    slug: "boundary-spanner",
    term: "boundary spanner",
    tier: "first-class",
    sentence:
      "A symbol that calls into several foreign regions — the joints of the architecture, and the first places a refactor hurts.",
    why: "These symbols hold the architecture together — and any boundary refactor lands on them first. They are where an interface change fans out into foreign regions.",
    caps: [
      "capped: outgoing calls only",
      "capped: at least 2 foreign regions required",
      "capped: test files are excluded",
    ],
    notCovered:
      "Incoming cross-region popularity is a different signal (see fan-in).",
    appearsIn: ["Overview"],
    seeAlso: ["fan", "coupling"],
  },
  {
    id: "M-CONF",
    slug: "confidence",
    term: "confidence",
    tier: "first-class",
    sentence:
      "How likely this call edge is real, given how the resolver found it.",
    why: "Low-confidence hops can turn a trace into a plausible story that isn't true. The word and the number always appear together: certain ≥95, likely 75–94, uncertain 50–74, speculative <50.",
    caps: [
      "capped: cross-language boundary → at most likely",
      "reduced: target overload set larger than 1",
      "speculative: dynamic dispatch unresolved",
    ],
    notCovered:
      "Reflection, code generation, and runtime dispatch are not modelled. Coverage is best-effort.",
    appearsIn: ["Flows", "Trace", "Symbol connections"],
  },
  {
    id: "M-DEAD",
    slug: "dead-candidate",
    term: "dead candidate",
    tier: "caveated",
    sentence:
      "Symbols with no recorded callers — candidates for removal, with caveats you must check first.",
    why: "The blocker to deleting dead code is fear of unintended breakage, not detection. This list is evidence, not a verdict — verify with a repo-wide search and tests before deleting.",
    notCovered:
      "Dynamic dispatch, reflection, exported API consumed outside this repository, and config-referenced entry points all look dead here and are not.",
    appearsIn: ["Dashboard"],
    seeAlso: ["fan", "confidence"],
  },
  {
    id: "M-TESTED",
    slug: "tested",
    term: "tested",
    tier: "caveated",
    sentence:
      "A TESTS edge reaches this symbol — some test exercises it, directly or through calls.",
    why: "A symbol no test reaches fails only in production. Reach is the floor of safety; hotspots without reach are the riskiest code in the repository.",
    notCovered:
      "Reached is not asserted: a test can execute this code without checking its result. Atlas deliberately shows reach, not a coverage percentage.",
    appearsIn: ["Dashboard", "Symbol"],
    pairedWith: "hotspot",
    seeAlso: ["coverage-gates"],
  },
  {
    id: "M-DOC",
    slug: "documented",
    term: "documented",
    tier: "caveated",
    sentence:
      "Exported symbols that carry a doc comment — a floor for explainability, not a measure of doc quality.",
    why: "An undocumented export forces every caller to read the implementation. A doc comment is a cheap floor that pays off at every call site — and in every agent prompt.",
    notCovered:
      "Comment presence only; accuracy and usefulness are not assessed.",
    appearsIn: ["Dashboard"],
  },
  {
    id: "M-DIVERG",
    slug: "divergence",
    term: "divergence",
    tier: "caveated",
    sentence:
      "Copies of this code that have started to drift apart — the risk is the drift, not the duplication.",
    why: "When copies drift, a bug fixed in one lives on in the other. Divergent near-clones are the copies that have already started disagreeing.",
    notCovered:
      "Duplication alone is a weak signal; identical, stable copies are mostly harmless. Divergence under change is the hazard this view ranks.",
    appearsIn: ["Symbol near-clones"],
  },
  {
    id: "M-HELP",
    slug: "who-can-help",
    term: "who can help",
    tier: "caveated",
    sentence:
      "People with recent, substantial history in this code — evidence for who to ask, never a performance measure.",
    why: "The most-sought information in twenty years of developer studies is what coworkers know. When the graph runs out of answers, the right person is the fastest path — this shows who, with the evidence.",
    notCovered:
      "Atlas never ranks people against each other and never shows per-person productivity. Names appear only with their evidence: commits, recency, breadth.",
    appearsIn: ["Symbol file history"],
  },
  {
    id: "M-REGION",
    slug: "region",
    term: "region",
    tier: "first-class",
    sentence:
      "A cluster of files that call each other more than they call anything else — Atlas's inferred modules.",
    why: "Modules inferred from actual call structure show the architecture as it is, not as the directory tree claims. Where the two disagree is usually worth a look.",
    notCovered:
      "Inferred from call structure, not from directory names; a region panel must answer why is this here — members, internal density, top external ties.",
    appearsIn: ["Galaxy", "Overview", "Modules"],
    seeAlso: ["cohesion", "coupling"],
  },
  {
    id: "M-HUB",
    slug: "hub",
    term: "hub",
    tier: "first-class",
    sentence:
      "The most-connected symbols in the graph — the ones most other code depends on, directly or transitively.",
    why: "A change to a hub is felt everywhere; an outage in one is an outage in many. Hubs deserve the strongest tests and the most careful review in the repository.",
    caps: [
      "capped: top 12 by connectivity are haloed; the cutoff is a display choice, not a cliff",
    ],
    notCovered: "Connectivity is static; a rarely-executed hub still ranks.",
    appearsIn: ["Galaxy halos", "Overview"],
    seeAlso: ["fan"],
  },
  {
    id: "M-BLAST",
    slug: "blast-radius",
    term: "blast radius",
    tier: "first-class",
    sentence:
      "Everything that can reach the code you changed — what could notice, grouped by region.",
    why: "Most regressions ship because a change was tested where it was made, not where it is felt. The blast list is what to retest before pushing.",
    notCovered:
      "Computed on the uncommitted diff today; hypothetical per-symbol impact and tests-to-run are planned. Confidence caveats apply along every path.",
    appearsIn: ["Changes"],
    seeAlso: ["fan", "confidence"],
  },
  {
    id: "M-SCENT",
    slug: "scent",
    term: "scent",
    tier: "first-class",
    sentence:
      "Where your search term concentrates across the map — follow the smell, not the guess.",
    why: "Search results drawn on the map show where a concept lives and how concentrated it is — one bright region means a clean home; scattered hits mean a crosscutting concern.",
    notCovered:
      "Name and text matches only; File and Folder nodes are excluded from counts.",
    appearsIn: ["Galaxy minimap", "Search"],
  },
  {
    id: "M-NEG-MI",
    slug: "maintainability-index",
    term: "maintainability index",
    tier: "refused",
    sentence:
      "Atlas does not show a Maintainability Index: its weights are folklore, it double-counts size, and it failed empirical validation.",
    why: "The MI's constants were fit to a handful of 1990s Hewlett-Packard systems and never revalidated; size dominates every term. What Atlas shows instead: churn, complexity and size separately, each with its own percentile.",
    appearsIn: ["Wiki only"],
  },
  {
    id: "M-NEG-HAL",
    slug: "halstead",
    term: "Halstead",
    tier: "refused",
    sentence:
      "Atlas does not compute Halstead metrics: token-counting science from 1977 that never replicated; size does its job better.",
    why: "Operator-and-operand counting promised effort and bug prediction it never delivered under replication; every useful signal it carries, plain size carries better.",
    appearsIn: ["Wiki only"],
  },
  {
    id: "M-NEG-COV",
    slug: "coverage-gates",
    term: "coverage gates",
    tier: "refused",
    sentence:
      "Atlas shows which tests reach a symbol, never a coverage-percentage target: rigid targets produce assertion-free tests.",
    why: "The correlation between coverage and post-release defects is weak and disappears above roughly 70–80%. Atlas shows test reach per symbol so you can judge the gap that matters.",
    appearsIn: ["Wiki only"],
    seeAlso: ["tested"],
  },
  {
    id: "M-NEG-GRADE",
    slug: "quality-grades",
    term: "quality grades",
    tier: "refused",
    sentence:
      "No A–F, no 0–100: a percentile in this repository carries the same information with no invented scale to misread.",
    why: "Published score curves still get read as linear; grades measurably undermine interest and performance relative to explanations; single scores with consequences invite gaming. Atlas ships percentiles, distributions and named caps instead.",
    appearsIn: ["Wiki only"],
  },
];

const bySlug = new Map(WIKI_ENTRIES.map((entry) => [entry.slug, entry]));
const byId = new Map(WIKI_ENTRIES.map((entry) => [entry.id, entry]));

export function wikiEntry(slug: string): WikiEntry | undefined {
  return bySlug.get(slug);
}

export function wikiEntryById(id: string): WikiEntry | undefined {
  return byId.get(id);
}
