/* Dashboard — one hero and its context. The hero is the churn × complexity
 * list (the evidence-backed "where the bugs live") with a knee-point head,
 * a cost sentence, and mute-as-intended dispositions. Quality signals get
 * tones and trends; inventory facts live in the footer; histograms exist
 * only with a computed takeaway. No composite score — the cards are the
 * score. Everything derives from the graph and one bounded git-log pass. */
import { useEffect, useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { kneeCount, costSentence, findingKey, isDismissed, dismiss } from "../lib/findings";

interface MetricEntry {
  qn?: string;
  name?: string;
  file?: string;
  value: number;
  commits?: number;
}

interface MetricsPayload {
  generated_from: string;
  totals: {
    callables: number;
    dead: number;
    tested_symbols: number;
    similar_edges: number;
    missed_files: number;
    exported: number;
    documented_exported: number;
    avg_complexity: number;
    files: number;
  };
  certainty: { calls: number; call_reference: number; usage: number };
  complexity_hist: number[];
  lines_hist: number[];
  top_complex: MetricEntry[];
  top_cognitive: MetricEntry[];
  top_long: MetricEntry[];
  top_churn: MetricEntry[];
  top_churn_complex: MetricEntry[];
  churn_available: boolean;
  churn_total_commits: number;
  churn_total_files: number;
  history: {
    indexed_at: string;
    callables: number;
    dead: number;
    avg_complexity: number;
    tested: number;
    usage_share: number;
  }[];
}

interface DashboardTabProps {
  project: string;
  onOpenSymbol: (ref: { qn: string }) => void;
  onOpenModulesPath: (path: string) => void;
}

const CPLX_LABELS = ["1", "2–5", "6–10", "11–20", "21–50", ">50"];

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const coords = points
    .map(
      (point, index) =>
        `${(index / (points.length - 1)) * 100},${28 - ((point - min) / span) * 24}`,
    )
    .join(" ");
  return (
    <svg viewBox="0 0 100 30" className="w-full h-[28px] mt-1" preserveAspectRatio="none">
      <polyline
        points={coords}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-primary/50"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function QualityCard({
  label,
  value,
  sub,
  tone,
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "warn" | "crit";
  trend?: number[];
}) {
  return (
    <div className="bg-card border border-border/50 rounded-md p-4 min-w-0">
      <p className="text-[12px] uppercase tracking-widest text-foreground/40">{label}</p>
      <p
        className={`text-[22px] font-semibold tabular-nums mt-1 ${
          tone === "crit" ? "text-crit" : tone === "warn" ? "text-warn" : "text-foreground/90"
        }`}
      >
        {value}
      </p>
      {sub && <p className="text-[12px] text-foreground/40 mt-0.5">{sub}</p>}
      {trend && trend.length > 1 && <Sparkline points={trend} />}
    </div>
  );
}

function TopList({
  title,
  entries,
  unit,
  onOpenSymbol,
}: {
  title: string;
  entries: MetricEntry[];
  unit: string;
  onOpenSymbol?: (ref: { qn: string }) => void;
}) {
  return (
    <div className="bg-card border border-border/50 rounded-md p-4">
      <p className="text-[12px] uppercase tracking-widest text-foreground/40 mb-2">{title}</p>
      <div className="space-y-px">
        {entries.map((entry, index) => {
          const label = entry.name ?? entry.file ?? "?";
          const clickable = entry.qn && onOpenSymbol;
          const Row = clickable ? "button" : "div";
          return (
            <Row
              key={`${label}-${index}`}
              onClick={clickable ? () => onOpenSymbol!({ qn: entry.qn! }) : undefined}
              className={`flex items-center gap-2 w-full text-left py-[3px] ${
                clickable ? "group cursor-pointer" : ""
              }`}
            >
              <span
                className={`text-[13px] font-mono truncate flex-1 ${
                  clickable
                    ? "text-foreground/60 group-hover:text-primary transition-colors"
                    : "text-foreground/55"
                }`}
                title={entry.qn ?? entry.file}
              >
                {label}
              </span>
              <span className="text-[12px] tabular-nums text-foreground/35 shrink-0">
                {entry.value.toLocaleString("en-US")} {unit}
              </span>
            </Row>
          );
        })}
        {entries.length === 0 && <p className="text-[13px] text-foreground/40">None.</p>}
      </div>
    </div>
  );
}

export function DashboardTab({ project, onOpenSymbol, onOpenModulesPath }: DashboardTabProps) {
  const [metrics, setMetrics] = useState<MetricsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showMuted, setShowMuted] = useState(false);
  const [mutedTick, setMutedTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setMetrics(null);
    setError(null);
    fetch(`/api/metrics?${new URLSearchParams({ project })}`)
      .then(async (res) => {
        if (!res.ok)
          throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
        return res.json();
      })
      .then((payload) => {
        if (!cancelled) setMetrics(payload);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "failed");
      });
    return () => {
      cancelled = true;
    };
  }, [project]);

  /* Hero rows: knee-point head + dispositions. */
  const hero = useMemo(() => {
    void mutedTick;
    const entries = metrics?.top_churn_complex ?? [];
    const head = kneeCount(entries.map((entry) => entry.value));
    const rows = entries.map((entry, index) => ({
      entry,
      inHead: index < head,
      key: findingKey("hotspot", entry.file ?? String(index), entry.value),
    }));
    return {
      visible: rows.filter((row) => showMuted || !isDismissed(row.key)),
      mutedCount: rows.filter((row) => isDismissed(row.key)).length,
      head,
      headCommits: entries
        .slice(0, head)
        .reduce((sum, entry) => sum + (entry.commits ?? 0), 0),
    };
  }, [metrics, showMuted, mutedTick]);

  const takeaway = useMemo(() => {
    if (!metrics) return null;
    const hist = metrics.complexity_hist;
    const total = hist.reduce((a, b) => a + b, 0);
    if (total === 0) return null;
    const simple = hist[0] + hist[1];
    const tail = hist[4] + hist[5];
    const names = metrics.top_complex
      .slice(0, 3)
      .map((entry) => entry.name)
      .filter(Boolean)
      .join(", ");
    return `${((simple / total) * 100).toFixed(0)}% of functions are simple (≤5); ${tail.toLocaleString("en-US")} exceed 20${names ? ` — led by ${names}` : ""}.`;
  }, [metrics]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-crit/90 text-sm">{error}</p>
      </div>
    );
  }
  if (!metrics) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-foreground/45 text-sm">Measuring…</p>
      </div>
    );
  }

  const { totals, certainty } = metrics;
  const callish = certainty.calls + certainty.call_reference + certainty.usage;
  const resolvedShare = callish > 0 ? (certainty.calls + certainty.call_reference) / callish : 0;
  const docShare = totals.exported > 0 ? totals.documented_exported / totals.exported : 0;
  const testedShare = totals.callables > 0 ? totals.tested_symbols / totals.callables : 0;
  const history = metrics.history ?? [];
  const cost = costSentence(
    hero.head,
    hero.headCommits,
    totals.files,
    metrics.churn_total_commits,
  );

  return (
    <ScrollArea className="h-full">
      <div className="max-w-[1200px] mx-auto px-6 py-6">
        {/* ── Hero: where the bugs live ─────────────────────────── */}
        <div className="bg-card border border-border/50 rounded-md p-5 mb-4">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h2 className="text-[17px] font-semibold text-foreground/90">
              Where the bugs live — churn × complexity
            </h2>
            {hero.mutedCount > 0 && (
              <button
                onClick={() => setShowMuted((value) => !value)}
                className="text-[12px] text-foreground/35 hover:text-foreground/60 transition-colors"
              >
                {showMuted ? "hide muted" : `${hero.mutedCount} muted — show`}
              </button>
            )}
          </div>
          {cost ? (
            <p className="text-[13px] text-foreground/55 mt-1">
              {cost} — change here is where defects concentrate.
            </p>
          ) : (
            <p className="text-[13px] text-foreground/45 mt-1">
              {metrics.churn_available
                ? "Not enough churn data yet."
                : "Churn unavailable — the project root has no readable git history."}
            </p>
          )}
          <div className="mt-3 space-y-px">
            {hero.visible.map(({ entry, inHead, key }) => (
              <div
                key={key}
                className={`flex items-center gap-3 rounded-md px-3 py-[6px] ${
                  inHead ? "bg-popover border-l-2 border-warn/70" : ""
                }`}
              >
                <button
                  onClick={() => {
                    const parent = entry.file?.split("/").slice(0, -1).join("/") ?? "";
                    onOpenModulesPath(parent);
                  }}
                  className="text-[13px] font-mono text-foreground/70 hover:text-primary truncate flex-1 text-left transition-colors"
                  title="Open in Modules"
                >
                  {entry.file}
                </button>
                <span className="text-[12px] tabular-nums text-foreground/45 shrink-0">
                  {entry.commits?.toLocaleString("en-US") ?? "?"} commits
                </span>
                <span className="text-[12px] tabular-nums text-foreground/35 shrink-0 w-20 text-right">
                  {entry.value.toLocaleString("en-US")}
                </span>
                <button
                  onClick={() => {
                    dismiss(key);
                    setMutedTick((tick) => tick + 1);
                  }}
                  className="text-[12px] text-foreground/25 hover:text-foreground/60 shrink-0 transition-colors"
                  title="Mute as intended — resurfaces if the score grows an order of magnitude"
                >
                  mute
                </button>
              </div>
            ))}
            {hero.visible.length === 0 && (
              <p className="text-[13px] text-foreground/40 py-2">
                Nothing here — either healthy, or everything is muted.
              </p>
            )}
          </div>
        </div>

        {/* ── Quality signals: toned, trended ───────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <QualityCard
            label="Call resolution"
            value={`${(resolvedShare * 100).toFixed(0)}%`}
            sub={`${certainty.usage.toLocaleString("en-US")} USAGE edges unproven`}
            tone={resolvedShare < 0.6 ? "warn" : undefined}
            trend={history.map((entry) => 1 - entry.usage_share)}
          />
          <QualityCard
            label="Dead candidates"
            value={totals.dead.toLocaleString("en-US")}
            sub="no callers; entry/test/exported excluded"
            tone={totals.dead > 0 ? "warn" : undefined}
            trend={history.map((entry) => entry.dead)}
          />
          <QualityCard
            label="Tested symbols"
            value={`${(testedShare * 100).toFixed(0)}%`}
            sub={`${totals.tested_symbols.toLocaleString("en-US")} with TESTS edges`}
            trend={history.map((entry) => entry.tested)}
          />
          <QualityCard
            label="Documented exports"
            value={`${(docShare * 100).toFixed(0)}%`}
            sub={`${totals.documented_exported.toLocaleString("en-US")} of ${totals.exported.toLocaleString("en-US")} exported`}
            tone={docShare < 0.3 ? "warn" : undefined}
          />
        </div>

        {/* ── Complexity, with its takeaway ─────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
          <div className="bg-card border border-border/50 rounded-md p-4">
            <p className="text-[12px] uppercase tracking-widest text-foreground/40">
              Complexity distribution
            </p>
            {takeaway && <p className="text-[13px] text-foreground/60 mt-1">{takeaway}</p>}
            <div className="flex items-end gap-1.5 h-[64px] mt-3">
              {metrics.complexity_hist.map((value, index) => {
                const max = Math.max(1, ...metrics.complexity_hist);
                return (
                  <div key={index} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <div
                      className={`w-full rounded-sm ${index >= 4 ? "bg-warn/60" : "bg-primary/35"}`}
                      style={{ height: `${Math.max(2, (value / max) * 40)}px` }}
                    />
                    <span className="text-[12px] text-foreground/35">{CPLX_LABELS[index]}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <TopList
            title="Most churned files (1y)"
            entries={metrics.top_churn}
            unit="commits"
          />
        </div>

        {/* ── Drill-down lists ──────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <TopList
            title="Most complex"
            entries={metrics.top_complex}
            unit="cyclo"
            onOpenSymbol={onOpenSymbol}
          />
          <TopList
            title="Hardest to follow"
            entries={metrics.top_cognitive}
            unit="cog"
            onOpenSymbol={onOpenSymbol}
          />
          <TopList
            title="Longest"
            entries={metrics.top_long}
            unit="lines"
            onOpenSymbol={onOpenSymbol}
          />
        </div>

        {/* ── Inventory footer — facts, untoned ─────────────────── */}
        <p className="text-[12px] text-foreground/35 tabular-nums border-t border-border/40 pt-3 mt-5">
          {totals.callables.toLocaleString("en-US")} callables ·{" "}
          {totals.files.toLocaleString("en-US")} files ·{" "}
          {totals.similar_edges.toLocaleString("en-US")} near-clone edges ·{" "}
          {totals.missed_files.toLocaleString("en-US")} files not fully indexed · computed from
          index {metrics.generated_from}
          {history.length > 1 && ` · trends across ${history.length} index runs`}
        </p>
      </div>
    </ScrollArea>
  );
}
