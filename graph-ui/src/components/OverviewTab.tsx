/* Overview — a findings feed on a landmark map. Four opinionated slots
 * answer "is anything wrong?"; findings are sentences with evidence, a next
 * click and a dismissal; the region map gives newcomers named landmarks;
 * reference material (hubs, entry points, boundaries) is one disclosure
 * away instead of shouting; inventory lives in the footer. */
import { useEffect, useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchArchitecture, archRows, type ArchitectureJson } from "../lib/atlas";
import { fetchRegions } from "../hooks/useGraphData";
import {
  disambiguateRegionNames,
  lensRegionsPayload,
  isBuiltinQn,
} from "../lib/regions";
import { surprisingCouplings, suggestedQuestions } from "../lib/firstread";
import { kneeCount, findingKey, isDismissed, dismiss } from "../lib/findings";
import { AddToPromptButton } from "./PromptBasket";
import type { RegionsPayload } from "../lib/types";

interface OverviewTabProps {
  project: string;
  onOpenRegion: (regionId: number) => void;
  onOpenSymbol: (qn: string) => void;
  onOpenModules: () => void;
  onOpenFlows: () => void;
  onOpenDashboard: () => void;
}

interface HotspotRow {
  qn: string;
  fan_in: number;
}
interface EntryRow {
  qn: string;
  file: string;
}
interface BoundaryRow {
  from: string;
  to: string;
  calls: number;
}
interface LanguageRow {
  language: string;
  files: number;
}

interface MetricsLite {
  generated_from: string;
  totals: { dead: number; missed_files: number; callables: number };
  top_churn_complex: { file?: string; value: number; commits?: number }[];
  churn_available: boolean;
  history: { indexed_at: string; dead: number; avg_complexity: number }[];
}

function shortQn(qn: string): string {
  return qn.split(".").slice(-2).join(".");
}

function Slot({
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "warn" | "crit" | "quiet";
  onClick?: () => void;
}) {
  const inner = (
    <>
      <p className="text-[12px] uppercase tracking-widest text-foreground/40">{label}</p>
      <p
        className={`font-semibold tabular-nums mt-1 truncate ${
          tone === "crit"
            ? "text-crit text-[22px]"
            : tone === "warn"
              ? "text-warn text-[22px]"
              : tone === "quiet"
                ? "text-foreground/60 text-[15px] mt-2"
                : "text-foreground/90 text-[22px]"
        }`}
      >
        {value}
      </p>
      {sub && <p className="text-[12px] text-foreground/40 mt-0.5 truncate">{sub}</p>}
    </>
  );
  return onClick ? (
    <button
      onClick={onClick}
      className="text-left bg-card border border-border/50 rounded-md p-4 min-w-0 hover:bg-surface-3 hover:border-primary/30 transition-all"
    >
      {inner}
    </button>
  ) : (
    <div className="bg-card border border-border/50 rounded-md p-4 min-w-0">{inner}</div>
  );
}

export function OverviewTab({
  project,
  onOpenRegion,
  onOpenSymbol,
  onOpenModules,
  onOpenFlows,
  onOpenDashboard,
}: OverviewTabProps) {
  const [arch, setArch] = useState<ArchitectureJson | null>(null);
  const [regions, setRegions] = useState<RegionsPayload | null>(null);
  const [metrics, setMetrics] = useState<MetricsLite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeTests, setIncludeTests] = useState(false);
  const [dismissedTick, setDismissedTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setArch(null);
    setRegions(null);
    setMetrics(null);
    setError(null);
    Promise.allSettled([
      fetchArchitecture(project),
      fetchRegions(project),
      fetch(`/api/metrics?${new URLSearchParams({ project })}`).then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(String(res.status))),
      ),
    ]).then(([archResult, regionsResult, metricsResult]) => {
      if (cancelled) return;
      if (archResult.status === "fulfilled") setArch(archResult.value);
      if (regionsResult.status === "fulfilled") setRegions(regionsResult.value);
      if (metricsResult.status === "fulfilled")
        setMetrics(metricsResult.value as MetricsLite);
      if (archResult.status === "rejected" && regionsResult.status === "rejected")
        setError(String(archResult.reason?.message ?? "failed to load"));
    });
    return () => {
      cancelled = true;
    };
  }, [project]);

  const lensed = useMemo(
    () => (regions ? lensRegionsPayload(regions, includeTests) : null),
    [regions, includeTests],
  );
  const displayRegions = useMemo(
    () => (lensed ? disambiguateRegionNames(lensed.regions) : []),
    [lensed],
  );
  const hiddenTestRegions =
    regions && lensed ? regions.regions.length - lensed.regions.length : 0;

  const couplings = useMemo(() => (lensed ? surprisingCouplings(lensed, 5) : []), [lensed]);
  const questions = useMemo(
    () =>
      lensed ? suggestedQuestions(lensed, { deadCount: metrics?.totals.dead }, 4) : [],
    [lensed, metrics],
  );

  /* Findings with dismissal (magnitude-bucketed keys re-alert on jumps). */
  const findings = useMemo(() => {
    void dismissedTick;
    return couplings
      .map((coupling) => ({
        coupling,
        key: findingKey(
          "coupling",
          `${coupling.source.name}⇄${coupling.target.name}`,
          coupling.weight,
        ),
      }))
      .filter((finding) => !isDismissed(finding.key));
  }, [couplings, dismissedTick]);
  const dismissedCount = couplings.length - findings.length;

  const hotspots = useMemo(
    () => archRows<HotspotRow>(arch, "hotspots").filter((row) => !isBuiltinQn(row.qn)),
    [arch],
  );
  const entries = useMemo(() => archRows<EntryRow>(arch, "entry_points"), [arch]);
  const boundaries = useMemo(() => archRows<BoundaryRow>(arch, "boundaries"), [arch]);
  const languages = useMemo(() => archRows<LanguageRow>(arch, "languages"), [arch]);
  const totalNodes =
    typeof arch?.total_nodes === "number" ? arch.total_nodes : regions?.total_nodes;
  const totalEdges = typeof arch?.total_edges === "number" ? arch.total_edges : undefined;

  /* The four slots. */
  const attention = useMemo(() => {
    const scores = (metrics?.top_churn_complex ?? []).map((entry) => entry.value);
    if (scores.length === 0) return null;
    return kneeCount(scores);
  }, [metrics]);
  const riskiest = metrics?.top_churn_complex?.[0] ?? null;
  const direction = useMemo(() => {
    const history = metrics?.history ?? [];
    if (history.length < 2) return null;
    const previous = history[history.length - 2];
    const current = history[history.length - 1];
    const deadDelta = current.dead - previous.dead;
    const cplxDelta = current.avg_complexity - previous.avg_complexity;
    const deadPart =
      deadDelta === 0 ? "dead →" : `dead ${deadDelta > 0 ? "+" : ""}${deadDelta}`;
    const cplxPart =
      Math.abs(cplxDelta) < 0.05 ? "complexity →" : `complexity ${cplxDelta > 0 ? "↑" : "↓"}`;
    return {
      text: `${deadPart} · ${cplxPart}`,
      worsening: deadDelta > 0 || cplxDelta > 0.05,
    };
  }, [metrics]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-crit/90 text-sm">{error}</p>
      </div>
    );
  }
  if (!arch && !regions) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-foreground/45 text-sm">Reading the map…</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="max-w-[1200px] mx-auto px-6 py-6">
        {/* The four slots: is anything wrong? */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <Slot
            label="Needs attention"
            value={
              attention === null
                ? metrics?.churn_available === false
                  ? "—"
                  : "…"
                : `${attention} file${attention === 1 ? "" : "s"}`
            }
            sub={
              attention === null
                ? "churn unavailable without git history"
                : "concentrate the churn × complexity risk"
            }
            tone={attention !== null && attention > 0 ? "warn" : undefined}
            onClick={onOpenDashboard}
          />
          <Slot
            label="Direction"
            value={direction ? direction.text : "first index"}
            sub={direction ? "since the previous index" : "trends appear after the next reindex"}
            tone={direction?.worsening ? "warn" : "quiet"}
          />
          <Slot
            label="Riskiest area"
            value={riskiest?.file?.split("/").slice(-1)[0] ?? "—"}
            sub={
              riskiest
                ? `${riskiest.commits ?? "?"} commits this year × high complexity — ${riskiest.file}`
                : "no complex churning files"
            }
            tone={riskiest ? "crit" : undefined}
            onClick={onOpenDashboard}
          />
          <Slot
            label="Trust"
            value={`${metrics?.totals.missed_files ?? 0} files missed`}
            sub={`index ${metrics?.generated_from?.slice(0, 10) ?? "…"} · ${regions?.unmapped_nodes ?? 0} unmapped symbols`}
            tone="quiet"
          />
        </div>

        {/* Findings — sentences with evidence, a next click, a dismissal. */}
        {(findings.length > 0 || dismissedCount > 0) && (
          <div className="mb-5">
            <div className="flex items-baseline gap-3 mb-2">
              <p className="text-[12px] uppercase tracking-widest text-foreground/40">
                Findings
              </p>
              {dismissedCount > 0 && (
                <span className="text-[12px] text-foreground/30">
                  {dismissedCount} dismissed
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {findings.map(({ coupling, key }) => (
                <div
                  key={key}
                  className="flex items-start gap-3 bg-card border border-border/50 rounded-md px-4 py-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] text-foreground/85">
                      <span className="font-medium">{coupling.source.name}</span>
                      <span className="text-foreground/40"> and </span>
                      <span className="font-medium">{coupling.target.name}</span>
                      <span className="text-foreground/40"> are unusually coupled</span>
                    </p>
                    <p className="text-[12px] text-foreground/45 mt-0.5">
                      {coupling.reasons.join(" · ")}
                    </p>
                  </div>
                  <button
                    onClick={() => onOpenRegion(coupling.source.id)}
                    className="text-[12px] text-primary/80 hover:text-primary shrink-0 transition-colors"
                  >
                    inspect
                  </button>
                  <button
                    onClick={() => {
                      dismiss(key);
                      setDismissedTick((tick) => tick + 1);
                    }}
                    className="text-[12px] text-foreground/30 hover:text-foreground/60 shrink-0 transition-colors"
                    title="Dismiss as intended — re-alerts if the coupling grows an order of magnitude"
                  >
                    intended
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Questions to hand your agent. */}
        {questions.length > 0 && (
          <div className="mb-5">
            <p className="text-[12px] uppercase tracking-widest text-foreground/40 mb-2">
              Questions this graph can answer — ask your agent
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {questions.map((question) => (
                <div
                  key={question.question}
                  className="flex items-start gap-2 bg-card border border-border/50 rounded-md px-3.5 py-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-foreground/80">{question.question}</p>
                    <p className="text-[12px] text-foreground/40 mt-0.5">{question.why}</p>
                  </div>
                  <AddToPromptButton
                    small
                    item={{
                      kind: "question",
                      question: question.question,
                      why: question.why,
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* The landmark map. */}
        <div className="mb-5">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[12px] uppercase tracking-widest text-foreground/40">
              Regions — the de-facto modules ({regions?.method ?? "…"})
            </p>
            {hiddenTestRegions > 0 && (
              <button
                onClick={() => setIncludeTests((value) => !value)}
                className="text-[12px] text-foreground/40 hover:text-foreground/70 transition-colors"
              >
                {includeTests
                  ? "hide test code"
                  : `${hiddenTestRegions} test region${hiddenTestRegions > 1 ? "s" : ""} hidden — show`}
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {displayRegions.slice(0, 12).map((region) => (
              <button
                key={region.id}
                onClick={() => onOpenRegion(region.id)}
                className="text-left rounded-md border border-border/40 bg-card hover:bg-surface-3 hover:border-primary/30 p-3 transition-all group"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: region.color }}
                  />
                  <span className="text-[13px] font-medium text-foreground/85 truncate group-hover:text-primary transition-colors">
                    {region.name}
                  </span>
                </div>
                <p className="text-[12px] text-foreground/45 truncate tabular-nums">
                  {region.members.toLocaleString("en-US")} symbols · cohesion{" "}
                  {region.cohesion.toFixed(2)}
                </p>
                {region.why && (
                  <p className="text-[12px] text-foreground/35 mt-1 line-clamp-2">
                    {region.why}
                  </p>
                )}
              </button>
            ))}
          </div>
          {displayRegions.length > 12 && (
            <button
              onClick={onOpenModules}
              className="mt-2 text-[13px] text-primary/80 hover:text-primary transition-colors"
            >
              all {displayRegions.length} regions in Modules →
            </button>
          )}
        </div>

        {/* Reference — one disclosure away, never shouting. */}
        <details className="mb-5">
          <summary className="cursor-pointer text-[12px] uppercase tracking-widest text-foreground/40 hover:text-foreground/60 transition-colors select-none">
            Reference — hubs, entry points, boundaries
          </summary>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
            <div className="bg-card border border-border/40 rounded-md p-4">
              <p className="text-[12px] uppercase tracking-widest text-foreground/40 mb-2">
                Hubs — highest fan-in
              </p>
              {hotspots.slice(0, 8).map((hotspot) => (
                <div key={hotspot.qn} className="flex items-center gap-2 py-[3px]">
                  <button
                    onClick={() => onOpenSymbol(hotspot.qn)}
                    className="text-[13px] font-mono text-foreground/65 hover:text-primary truncate flex-1 text-left transition-colors"
                    title={hotspot.qn}
                  >
                    {shortQn(hotspot.qn)}
                  </button>
                  <span className="text-[12px] tabular-nums text-foreground/35 shrink-0">
                    {Number(hotspot.fan_in).toLocaleString("en-US")}
                  </span>
                </div>
              ))}
              {hotspots.length === 0 && (
                <p className="text-[13px] text-foreground/40">No hotspot data.</p>
              )}
            </div>
            <div className="bg-card border border-border/40 rounded-md p-4">
              <p className="text-[12px] uppercase tracking-widest text-foreground/40 mb-2">
                Entry points
              </p>
              {entries.slice(0, 8).map((entry) => (
                <button
                  key={entry.qn}
                  onClick={() => onOpenSymbol(entry.qn)}
                  className="flex items-center gap-2 w-full text-left py-[3px] group/entry"
                  title={entry.qn}
                >
                  <span className="text-[13px] font-mono text-foreground/65 group-hover/entry:text-primary truncate transition-colors">
                    {shortQn(entry.qn)}
                  </span>
                  <span className="text-[12px] text-foreground/30 truncate ml-auto shrink-0 max-w-[45%]">
                    {entry.file}
                  </span>
                </button>
              ))}
              <button
                onClick={onOpenFlows}
                className="mt-2 text-[12px] text-primary/80 hover:text-primary transition-colors"
              >
                follow them in Flows →
              </button>
            </div>
            <div className="bg-card border border-border/40 rounded-md p-4 md:col-span-2 overflow-x-auto">
              <p className="text-[12px] uppercase tracking-widest text-foreground/40 mb-2">
                Boundaries — cross-package calls
              </p>
              <table className="w-full text-[13px]">
                <tbody>
                  {boundaries.slice(0, 8).map((boundary, index) => (
                    <tr key={index} className="border-t border-border/30 first:border-t-0">
                      <td className="py-1 pr-4 font-mono text-foreground/60">
                        {boundary.from}
                      </td>
                      <td className="py-1 pr-4 font-mono text-foreground/60">{boundary.to}</td>
                      <td className="py-1 text-right tabular-nums text-foreground/40">
                        {Number(boundary.calls).toLocaleString("en-US")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {boundaries.length === 0 && (
                <p className="text-[13px] text-foreground/40">No cross-package calls recorded.</p>
              )}
            </div>
          </div>
        </details>

        {/* Inventory footer — facts, untoned. */}
        <p className="text-[12px] text-foreground/35 tabular-nums border-t border-border/40 pt-3">
          {totalNodes?.toLocaleString("en-US") ?? "…"} symbols ·{" "}
          {totalEdges?.toLocaleString("en-US") ?? "…"} edges ·{" "}
          {regions?.regions.length ?? "…"} regions ·{" "}
          {languages
            .slice(0, 4)
            .map((lang) => lang.language)
            .join(" · ") || "…"}
        </p>
      </div>
    </ScrollArea>
  );
}
