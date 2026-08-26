import { fetchJsonFrom } from "./whyfetch";

/* The Why view's data layer. Guards are SYNTACTIC: the conditions the code
 * lexically wraps a call site in — never proven path conditions. */

export interface Guard {
  kind: "if" | "else" | "case" | "loop" | "ternary" | "catch" | "switch" | string;
  cond?: string;
  negated?: boolean;
}

export interface WhyEntry {
  id: number;
  name: string;
  qualified_name?: string;
  file_path?: string;
  line?: number;
  guards: Guard[];
  loop?: boolean;
  guards_unavailable?: boolean;
  more: number;
}

export interface WhyPayload {
  symbol: { id: number; name: string; file_path?: string };
  direction: "up" | "down";
  total: number;
  entries: WhyEntry[];
  guards_unavailable: number;
  sources_readable: boolean;
}

export function fetchWhy(
  project: string,
  ref: { id?: number; qn?: string },
  direction: "up" | "down",
): Promise<WhyPayload> {
  const params = new URLSearchParams({ project, dir: direction });
  if (ref.id !== undefined) params.set("id", String(ref.id));
  else if (ref.qn) params.set("qn", ref.qn);
  return fetchJsonFrom(`/api/why?${params}`);
}

/* One guard as human text: `when mode > 2` / `unless strict` /
 * `case CBM_LANG_C` / `in a loop` / `in catch`. */
export function formatGuard(guard: Guard): string {
  const cond = guard.cond ?? "";
  switch (guard.kind) {
    case "if":
    case "ternary":
      if (!cond) return guard.negated ? "in an else arm" : "conditionally";
      return `${guard.negated ? "unless" : "when"} ${cond}`;
    case "case":
      return cond ? `case ${cond}` : "in a switch case";
    case "switch":
      return cond ? `switch on ${cond}` : "in a switch";
    case "loop":
      return cond ? `looping while ${cond}` : "in a loop";
    case "catch":
      return "on error handling";
    default:
      return cond || guard.kind;
  }
}

/* A whole chain as one sentence fragment, outermost first. */
export function formatGuardChain(guards: Guard[]): string {
  return guards.map(formatGuard).join(" → ");
}

/* Trivial-trigger check: the complexity gate. A symbol whose callers are all
 * unguarded earns a single line, not a tree (Scanlan: conditional diagrams
 * pay off only when conditional complexity is real). */
export function allUnguarded(entries: WhyEntry[]): boolean {
  return entries.every((entry) => entry.guards.length === 0 && !entry.loop);
}
