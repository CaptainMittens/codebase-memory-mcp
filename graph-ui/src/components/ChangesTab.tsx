/* Changes — what am I about to break: detect_changes on the working tree,
 * grouped by risk, every affected symbol one click from its page and the
 * whole blast radius one click from the prompt composer. */
import { useEffect, useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchChanges, archRows, type ArchitectureJson } from "../lib/atlas";
import { usePromptBasket } from "./PromptBasket";

interface ChangesTabProps {
  project: string;
  onOpenSymbol: (ref: { id?: number; qn?: string }) => void;
}

interface AffectedRow {
  qn?: string;
  symbol?: string;
  file?: string;
  risk?: string;
  hops?: number;
  [key: string]: string | number | null | undefined;
}

const RISK_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const RISK_TONE: Record<string, string> = {
  CRITICAL: "text-red-300/90 border-red-300/40 bg-red-400/10",
  HIGH: "text-amber-300/90 border-amber-300/40 bg-amber-400/10",
  MEDIUM: "text-sky-300/80 border-sky-300/30 bg-sky-400/5",
  LOW: "text-foreground/50 border-border/40 bg-white/[0.02]",
};

export function ChangesTab({ project, onOpenSymbol }: ChangesTabProps) {
  const [result, setResult] = useState<ArchitectureJson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const basket = usePromptBasket();

  const run = () => {
    setLoading(true);
    setError(null);
    fetchChanges(project)
      .then(setResult)
      .catch((err) => setError(err instanceof Error ? err.message : "failed"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [project]);

  const sections = useMemo(() => {
    if (!result) return [];
    /* detect_changes(format:"json") emits {cols, rows} sections; collect
     * whichever carry symbol-shaped rows, keep scalars as banner text. */
    return Object.entries(result)
      .filter(([, value]) => typeof value === "object" && value !== null && "cols" in value)
      .map(([name]) => ({ name, rows: archRows<AffectedRow>(result, name) }))
      .filter((section) => section.rows.length > 0);
  }, [result]);

  const scalars = useMemo(() => {
    if (!result) return [];
    return Object.entries(result).filter(
      ([, value]) => typeof value === "string" || typeof value === "number",
    ) as [string, string | number][];
  }, [result]);

  const riskOf = (row: AffectedRow): string => String(row.risk ?? "LOW").toUpperCase();
  const qnOf = (row: AffectedRow): string | undefined =>
    (row.qn as string) ?? (row.symbol as string) ?? undefined;

  const affected = useMemo(() => {
    const rows = sections.flatMap((section) => section.rows).filter((row) => qnOf(row));
    return [...rows].sort(
      (a, b) => RISK_ORDER.indexOf(riskOf(a)) - RISK_ORDER.indexOf(riskOf(b)),
    );
  }, [sections]);

  return (
    <ScrollArea className="h-full">
      <div className="max-w-[1000px] mx-auto px-6 py-6">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <h2 className="text-[16px] font-semibold text-foreground/90">
            Working-tree impact
          </h2>
          <button
            onClick={run}
            disabled={loading}
            className="px-3 py-1.5 rounded-md bg-primary/15 text-primary text-[12px] font-medium hover:bg-primary/25 transition-colors disabled:opacity-40"
          >
            {loading ? "Analyzing…" : result ? "Re-analyze" : "Analyze my uncommitted changes"}
          </button>
          {affected.length > 0 && (
            <button
              onClick={() => {
                for (const row of affected.slice(0, 20)) {
                  const qn = qnOf(row)!;
                  basket.add({
                    kind: "symbol",
                    id: -1 - affected.indexOf(row),
                    name: qn.split(".").pop() ?? qn,
                    qualified_name: qn,
                    file_path: (row.file as string) ?? undefined,
                  });
                }
              }}
              className="px-3 py-1.5 rounded-md bg-white/[0.05] text-foreground/60 text-[12px] font-medium hover:bg-white/[0.09] transition-colors"
            >
              Cite blast radius in prompt
            </button>
          )}
        </div>

        {error && <p className="text-red-400/80 text-[12px] mb-3">{error}</p>}
        {!result && !loading && !error && (
          <p className="text-[12.5px] text-foreground/40 max-w-[65ch] leading-relaxed">
            Runs <span className="font-mono text-foreground/60">detect_changes</span> against the
            project's git working tree: changed symbols, their transitive callers with risk
            classification, and the tests that cover them — the map to read before asking an
            agent to finish a refactor.
          </p>
        )}

        {scalars.length > 0 && (
          <div className="flex flex-wrap gap-4 mb-4">
            {scalars.map(([key, value]) => (
              <div key={key}>
                <p className="text-[9px] uppercase tracking-widest text-foreground/25">
                  {key.replace(/_/g, " ")}
                </p>
                <p className="text-[13px] text-foreground/70 tabular-nums">{String(value)}</p>
              </div>
            ))}
          </div>
        )}

        {result && affected.length === 0 && (
          <p className="text-[12px] text-foreground/40">
            No affected symbols — the working tree is clean or the changes touch nothing indexed.
          </p>
        )}

        {affected.length > 0 && (
          <div className="space-y-px">
            {affected.map((row, index) => {
              const risk = riskOf(row);
              const qn = qnOf(row)!;
              return (
                <button
                  key={`${qn}-${index}`}
                  onClick={() => onOpenSymbol({ qn })}
                  className="flex items-center gap-2.5 w-full text-left px-2 py-[5px] rounded-md hover:bg-white/[0.04] transition-colors group"
                >
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 ${RISK_TONE[risk] ?? RISK_TONE.LOW}`}
                  >
                    {risk}
                  </span>
                  <span className="text-[12px] font-mono text-foreground/70 group-hover:text-primary truncate transition-colors">
                    {qn}
                  </span>
                  <span className="text-[10px] text-foreground/25 truncate ml-auto shrink-0 max-w-[35%]">
                    {(row.file as string) ?? ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
