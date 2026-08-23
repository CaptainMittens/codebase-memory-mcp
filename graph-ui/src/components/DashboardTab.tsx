/* Dashboard — the project's numbers with the code behind them one click
 * away. No composite health score: the cards are the score. Everything is
 * derived from the graph (and one bounded git-log pass); nothing here asks
 * a model anything. */
import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface MetricEntry {
  qn?: string;
  name?: string;
  file?: string;
  value: number;
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
}

const CPLX_LABELS = ["1", "2–5", "6–10", "11–20", "21–50", ">50"];
const LINE_LABELS = ["≤10", "≤30", "≤60", "≤120", ">120"];

function Histogram({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-1.5 h-[72px] mt-2">
      {values.map((value, index) => (
        <div key={index} className="flex-1 flex flex-col items-center gap-1 min-w-0">
          <span className="text-[9px] tabular-nums text-foreground/30">
            {value.toLocaleString("en-US")}
          </span>
          <div
            className="w-full rounded-sm bg-primary/40"
            style={{ height: `${Math.max(2, (value / max) * 46)}px` }}
          />
          <span className="text-[8.5px] text-foreground/25">{labels[index]}</span>
        </div>
      ))}
    </div>
  );
}

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
    <svg viewBox="0 0 100 30" className="w-full h-[30px] mt-1" preserveAspectRatio="none">
      <polyline points={coords} fill="none" stroke="currentColor" strokeWidth="1.5"
        className="text-primary/60" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function StatCard({
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
    <div className="bg-white/[0.02] border border-border/40 rounded-xl p-4 min-w-0">
      <p className="text-[9px] uppercase tracking-widest text-foreground/30">{label}</p>
      <p
        className={`text-[22px] font-semibold tabular-nums mt-1 ${
          tone === "crit"
            ? "text-red-300/90"
            : tone === "warn"
              ? "text-amber-300/90"
              : "text-foreground/90"
        }`}
      >
        {value}
      </p>
      {sub && <p className="text-[10px] text-foreground/30 mt-0.5">{sub}</p>}
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
    <div className="bg-white/[0.02] border border-border/40 rounded-xl p-4">
      <p className="text-[10px] uppercase tracking-widest text-foreground/30 mb-2">{title}</p>
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
                className={`text-[11px] font-mono truncate flex-1 ${
                  clickable
                    ? "text-foreground/60 group-hover:text-primary transition-colors"
                    : "text-foreground/55"
                }`}
                title={entry.qn ?? entry.file}
              >
                {label}
              </span>
              <span className="text-[10px] tabular-nums text-foreground/35 shrink-0">
                {entry.value.toLocaleString("en-US")} {unit}
              </span>
            </Row>
          );
        })}
        {entries.length === 0 && <p className="text-[11px] text-foreground/25">None.</p>}
      </div>
    </div>
  );
}

export function DashboardTab({ project, onOpenSymbol }: DashboardTabProps) {
  const [metrics, setMetrics] = useState<MetricsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMetrics(null);
    setError(null);
    fetch(`/api/metrics?${new URLSearchParams({ project })}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
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

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-red-400/80 text-sm">{error}</p>
      </div>
    );
  }
  if (!metrics) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-white/30 text-sm">Measuring…</p>
      </div>
    );
  }

  const { totals, certainty } = metrics;
  const callish = certainty.calls + certainty.call_reference + certainty.usage;
  const resolvedShare = callish > 0 ? (certainty.calls + certainty.call_reference) / callish : 0;
  const docShare = totals.exported > 0 ? totals.documented_exported / totals.exported : 0;
  const testedShare = totals.callables > 0 ? totals.tested_symbols / totals.callables : 0;
  const history = metrics.history ?? [];

  return (
    <ScrollArea className="h-full">
      <div className="max-w-[1200px] mx-auto px-6 py-6">
        <p className="text-[10px] text-foreground/25 font-mono mb-4">
          computed from index {metrics.generated_from}
          {history.length > 1 && ` · trends across ${history.length} index runs`}
        </p>

        {/* Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard
            label="Callables"
            value={totals.callables.toLocaleString("en-US")}
            sub={`avg complexity ${totals.avg_complexity.toFixed(1)}`}
            trend={history.map((entry) => entry.callables)}
          />
          <StatCard
            label="Call resolution"
            value={`${(resolvedShare * 100).toFixed(0)}%`}
            sub={`${certainty.usage.toLocaleString("en-US")} USAGE edges unproven`}
            tone={resolvedShare < 0.6 ? "warn" : undefined}
            trend={history.map((entry) => 1 - entry.usage_share)}
          />
          <StatCard
            label="Dead candidates"
            value={totals.dead.toLocaleString("en-US")}
            sub="no callers; entry/test/exported excluded"
            tone={totals.dead > 0 ? "warn" : undefined}
            trend={history.map((entry) => entry.dead)}
          />
          <StatCard
            label="Tested symbols"
            value={`${(testedShare * 100).toFixed(0)}%`}
            sub={`${totals.tested_symbols.toLocaleString("en-US")} with TESTS edges`}
            trend={history.map((entry) => entry.tested)}
          />
          <StatCard
            label="Documented exports"
            value={`${(docShare * 100).toFixed(0)}%`}
            sub={`${totals.documented_exported.toLocaleString("en-US")} of ${totals.exported.toLocaleString("en-US")} exported`}
            tone={docShare < 0.3 ? "warn" : undefined}
          />
          <StatCard
            label="Near-clone edges"
            value={totals.similar_edges.toLocaleString("en-US")}
            sub="SIMILAR_TO (MinHash)"
          />
          <StatCard
            label="Files not fully indexed"
            value={totals.missed_files.toLocaleString("en-US")}
            sub="the missed skeleton in the galaxy"
            tone={totals.missed_files > 0 ? "warn" : undefined}
          />
          <div className="bg-white/[0.02] border border-border/40 rounded-xl p-4">
            <p className="text-[9px] uppercase tracking-widest text-foreground/30">
              Complexity distribution
            </p>
            <Histogram values={metrics.complexity_hist} labels={CPLX_LABELS} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <div className="bg-white/[0.02] border border-border/40 rounded-xl p-4">
            <p className="text-[9px] uppercase tracking-widest text-foreground/30">
              Function length (lines)
            </p>
            <Histogram values={metrics.lines_hist} labels={LINE_LABELS} />
          </div>
          <TopList
            title={
              metrics.churn_available
                ? "Where the bugs live — churn × complexity (1y)"
                : "Churn unavailable (no git history readable)"
            }
            entries={metrics.top_churn_complex}
            unit="score"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <TopList title="Most complex" entries={metrics.top_complex} unit="cyclo" onOpenSymbol={onOpenSymbol} />
          <TopList title="Hardest to follow" entries={metrics.top_cognitive} unit="cog" onOpenSymbol={onOpenSymbol} />
          <TopList title="Longest" entries={metrics.top_long} unit="lines" onOpenSymbol={onOpenSymbol} />
          <TopList title="Most churned files (1y)" entries={metrics.top_churn} unit="commits" />
        </div>
      </div>
    </ScrollArea>
  );
}
