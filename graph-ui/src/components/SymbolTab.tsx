/* Symbol — one page per node, addressable by id or qualified name: what it
 * is (docstring, flags), where it lives (region, file, editor links), who
 * calls it and whom it calls (true totals, paged, confidence-ordered),
 * what tests it, what changes with it, and what nearly duplicates it. */
import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { callTool } from "../api/rpc";
import {
  fetchSymbol,
  type ConnectionPage,
  type DataFlowRef,
  type SymbolBundle,
  type SymbolRef,
} from "../lib/atlas";
import { useUiMessages } from "../lib/i18n";
import { fetchImpact, impactSentence, type ImpactPayload } from "../lib/impact";
import {
  commitUrl,
  fetchSymbolHistory,
  linkifyRefs,
  refUrl,
  type SymbolCommit,
  type SymbolHistoryPayload,
} from "../lib/rationale";
import { AddToPromptButton } from "./PromptBasket";
import { MetricChip } from "./MetricChip";
import { TriggerTree } from "./TriggerTree";
import type { RepoInfo } from "../lib/types";

interface SymbolTabProps {
  project: string;
  symbolRef: { id?: number; qn?: string };
  onOpenSymbol: (ref: { id?: number; qn?: string }) => void;
  onOpenRegion: (regionId: number) => void;
  onOpenWiki: (slug: string) => void;
}

const CONFIDENCE: Record<string, { label: string; tone: string }> = {
  CALLS: { label: "resolved", tone: "text-emerald-300/80 border-emerald-300/30" },
  CALL_REFERENCE: { label: "reference", tone: "text-sky-300/80 border-sky-300/30" },
  USAGE: { label: "unproven", tone: "text-amber-300/80 border-amber-300/30" },
  HTTP_CALLS: { label: "http", tone: "text-purple-300/80 border-purple-300/30" },
  ASYNC_CALLS: { label: "async", tone: "text-purple-300/80 border-purple-300/30" },
};

function ConnectionList({
  title,
  page,
  homeRegion,
  onLoadMore,
  onOpenSymbol,
  onOpenWiki,
}: {
  title: string;
  page: ConnectionPage;
  homeRegion?: number;
  onLoadMore: () => void;
  onOpenSymbol: (ref: { id?: number; qn?: string }) => void;
  onOpenWiki: (slug: string) => void;
}) {
  const shown = page.offset + page.items.length;
  /* A utility called from everywhere would carry a dot on every row — the
   * signal inverts into noise. Past half, say it once instead. */
  const crossCount =
    homeRegion === undefined
      ? 0
      : page.items.filter((i) => i.region !== undefined && i.region !== homeRegion).length;
  const dotsUseful = crossCount > 0 && crossCount <= page.items.length / 2;
  return (
    <div className="bg-card border border-border/40 rounded-md p-4">
      <div className="flex items-baseline gap-2 mb-2">
        <p className="text-[12px] uppercase tracking-widest text-foreground/45">{title}</p>
        <span className="text-[13px] tabular-nums text-foreground/40">
          {page.total.toLocaleString("en-US")}
        </span>
        {!dotsUseful && crossCount > 0 && (
          <span
            className="text-[12px] text-foreground/40"
            title="most of these live in other regions — the cross-seam dot is omitted because it would mark nearly every row"
          >
            {crossCount} of {page.items.length} cross regions
          </span>
        )}
        <span className="text-[12px] text-foreground/40 ml-auto">
          <MetricChip slug="confidence" onOpen={onOpenWiki}>
            {Object.entries(page.by_type)
              .map(([type, count]) => `${CONFIDENCE[type]?.label ?? type.toLowerCase()} ${count}`)
              .join(" · ")}
          </MetricChip>
        </span>
      </div>
      <div className="space-y-px">
        {page.items.map((item, index) => (
          <button
            key={`${item.id}-${index}`}
            onClick={() => onOpenSymbol({ id: item.id })}
            className="flex items-center gap-2 w-full text-left px-2 py-[4px] rounded-md hover:bg-surface-3 transition-colors group"
          >
            <span
              className={`text-[12px] px-1 rounded border shrink-0 ${CONFIDENCE[item.type ?? ""]?.tone ?? "text-foreground/40 border-border/40"}`}
            >
              {CONFIDENCE[item.type ?? ""]?.label ?? item.type}
            </span>
            <span className="text-[13px] font-mono text-foreground/65 group-hover:text-primary truncate transition-colors">
              {item.name}
            </span>
            {dotsUseful &&
              item.region !== undefined &&
              homeRegion !== undefined &&
              item.region !== homeRegion && (
                <span
                  className="w-[6px] h-[6px] rounded-full bg-primary/70 shrink-0"
                  title="in another region — this edge crosses an architectural seam"
                />
              )}
            <span className="text-[12px] text-foreground/35 truncate ml-auto shrink-0 max-w-[45%]">
              {item.file_path}
            </span>
          </button>
        ))}
        {page.items.length === 0 && (
          <p className="text-[13px] text-foreground/40 px-2 py-2">None.</p>
        )}
      </div>
      {shown < page.total && (
        <>
          <button
            onClick={onLoadMore}
            className="mt-1.5 px-2 text-[12px] text-primary/70 hover:text-primary transition-colors"
          >
            Show more ({(page.total - shown).toLocaleString("en-US")} hidden)
          </button>
          {(page.overflow_by_file?.length ?? 0) > 0 && (
            <div className="mt-1 px-2">
              <p className="text-[12px] text-foreground/35 mb-0.5">hidden, by file:</p>
              {page.overflow_by_file!.map((row) => (
                <p
                  key={row.file}
                  className="text-[12px] font-mono text-foreground/45 truncate tabular-nums"
                >
                  {row.file} × {row.count}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* One commit line: hash · subject · author · date. With a forge base the
 * hash links to the commit and "#123" subject refs link to /issues/123
 * (forges route that to PRs too); without one everything stays plain. */
function CommitRow({ commit, remote }: { commit: SymbolCommit; remote?: string }) {
  return (
    <div className="flex items-baseline gap-2 py-[3px]">
      {remote ? (
        <a
          href={commitUrl(remote, commit.hash)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[12px] font-mono text-foreground/35 hover:text-foreground/70 shrink-0 transition-colors"
        >
          {commit.hash}
        </a>
      ) : (
        <span className="text-[12px] font-mono text-foreground/35 shrink-0">
          {commit.hash}
        </span>
      )}
      <span className="text-[13px] text-foreground/70 truncate flex-1">
        {remote
          ? linkifyRefs(commit.subject).map((segment, index) =>
              segment.ref !== undefined ? (
                <a
                  key={index}
                  href={refUrl(remote, segment.ref)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary/70 hover:text-primary transition-colors"
                >
                  {segment.text}
                </a>
              ) : (
                <span key={index}>{segment.text}</span>
              ),
            )
          : commit.subject}
      </span>
      <span className="text-[12px] text-foreground/35 shrink-0">
        {commit.author} ·{" "}
        {new Date(commit.time * 1000).toISOString().slice(0, 10)}
      </span>
    </div>
  );
}

export function SymbolTab({
  project,
  symbolRef,
  onOpenSymbol,
  onOpenRegion,
  onOpenWiki,
}: SymbolTabProps) {
  const t = useUiMessages();
  const [bundle, setBundle] = useState<SymbolBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);
  const [code, setCode] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
  const [impact, setImpact] = useState<ImpactPayload | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [history, setHistory] = useState<SymbolHistoryPayload | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBundle(null);
    setError(null);
    setCode(null);
    setHistory(null);
    setHistoryError(null);
    fetchSymbol(project, symbolRef, limit, 0)
      .then((payload) => {
        if (!cancelled) setBundle(payload);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "failed");
      });
    return () => {
      cancelled = true;
    };
  }, [project, symbolRef.id, symbolRef.qn, limit]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/repo-info?project=${encodeURIComponent(project)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data && !data.error) setRepoInfo(data as RepoInfo);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project]);

  useEffect(() => {
    let cancelled = false;
    setImpact(null);
    setImpactError(null);
    fetchImpact(project, symbolRef)
      .then((payload) => {
        if (!cancelled) setImpact(payload);
      })
      .catch((err) => {
        if (!cancelled) setImpactError(err instanceof Error ? err.message : "failed");
      });
    return () => {
      cancelled = true;
    };
  }, [project, symbolRef.id, symbolRef.qn]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-red-400/80 text-sm">{error}</p>
      </div>
    );
  }
  if (!bundle) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-foreground/45 text-sm">Loading symbol…</p>
      </div>
    );
  }

  const { node } = bundle;
  const lineSuffix = node.start_line
    ? `#L${node.start_line}${node.end_line && node.end_line !== node.start_line ? `-L${node.end_line}` : ""}`
    : "";
  const ghUrl =
    repoInfo?.blob_base && node.file_path
      ? `${repoInfo.blob_base}/${node.file_path.split("/").map(encodeURIComponent).join("/")}${lineSuffix}`
      : null;
  const editorUrl =
    repoInfo?.root_path && node.file_path
      ? `vscode://file/${repoInfo.root_path}/${node.file_path}${node.start_line ? `:${node.start_line}` : ""}`
      : null;

  /* The cumulative hop tiers: "12 direct callers · 48 within 2 hops ·
   * 210 total within 10" — only the tiers this symbol actually has. */
  const impactDirect = impact?.by_distance[0] ?? 0;
  const impactTiers =
    impact && impact.reachable > 0
      ? [
          `${impactDirect.toLocaleString("en-US")} direct caller${impactDirect === 1 ? "" : "s"}`,
          ...(impact.max_distance >= 2
            ? [
                `${(impactDirect + (impact.by_distance[1] ?? 0)).toLocaleString("en-US")} within 2 hops`,
              ]
            : []),
          ...(impact.max_distance > 2
            ? [
                `${impact.reachable.toLocaleString("en-US")} total within ${impact.max_depth}`,
              ]
            : []),
        ].join(" · ")
      : null;

  /* The trace is a deliberate click: each call runs one git subprocess
   * (git log -L) on the server, so it is never fetched automatically. */
  const canTrace = Boolean(node.file_path && node.start_line && node.end_line);
  const loadHistory = async () => {
    if (!node.file_path || !node.start_line || !node.end_line) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setHistory(
        await fetchSymbolHistory(project, node.file_path, node.start_line, node.end_line),
      );
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "failed");
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadCode = async () => {
    if (!node.qualified_name) return;
    setCodeLoading(true);
    try {
      const result = await callTool<{ source?: string }>("get_code_snippet", {
        qualified_name: node.qualified_name,
        project,
      });
      setCode(result.source ?? "(source not available)");
    } catch (err) {
      setCode(err instanceof Error ? err.message : "failed to load code");
    } finally {
      setCodeLoading(false);
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="max-w-[1100px] mx-auto px-6 py-6">
        {/* Header */}
        <div className="mb-5">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-[20px] font-semibold text-foreground/95 font-mono">
              {node.name}
            </h2>
            <span className="px-2 py-0.5 rounded-md text-[12px] font-medium bg-surface-3 text-foreground/60">
              {node.label}
            </span>
            {node.is_entry && (
              <span className="px-2 py-0.5 rounded-md text-[12px] bg-emerald-400/10 text-emerald-300/80">
                entry point
              </span>
            )}
            {node.is_test && (
              <span className="px-2 py-0.5 rounded-md text-[12px] bg-surface-3 text-foreground/50">
                test
              </span>
            )}
            {node.is_exported && (
              <span className="px-2 py-0.5 rounded-md text-[12px] bg-sky-400/10 text-sky-300/80">
                exported
              </span>
            )}
            <div className="ml-auto flex gap-2 items-center">
              <AddToPromptButton
                item={{
                  kind: "symbol",
                  id: node.id,
                  name: node.name,
                  qualified_name: node.qualified_name,
                  file_path: node.file_path,
                  start_line: node.start_line,
                  end_line: node.end_line,
                }}
              />
            </div>
          </div>
          {node.qualified_name && (
            <p className="text-[13px] font-mono text-foreground/50 mt-1.5 break-all">
              {node.qualified_name}
            </p>
          )}
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {node.file_path && (
              <p className="text-[13px] font-mono text-foreground/45">
                {node.file_path}
                {node.start_line ? `:${node.start_line}` : ""}
              </p>
            )}
            {bundle.region && (
              <button
                onClick={() => onOpenRegion(bundle.region!.id)}
                className="text-[13px] text-primary/70 hover:text-primary transition-colors"
              >
                region: {bundle.region.name ?? bundle.region.id} →
              </button>
            )}
            {editorUrl && (
              <a href={editorUrl} className="text-[13px] text-foreground/40 hover:text-foreground/70 transition-colors">
                Open in editor ↗
              </a>
            )}
            {ghUrl && (
              <a
                href={ghUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] text-foreground/40 hover:text-foreground/70 transition-colors"
              >
                GitHub ↗
              </a>
            )}
          </div>
          {node.docstring && (
            <p className="text-[12.5px] text-foreground/60 mt-3 max-w-[75ch] leading-relaxed border-l-2 border-primary/30 pl-3">
              {node.docstring}
            </p>
          )}
          <div className="mt-3">
            <button
              onClick={code ? () => setCode(null) : loadCode}
              disabled={codeLoading || !node.qualified_name}
              className="px-2.5 py-1 rounded-md bg-primary/15 text-primary text-[13px] font-medium hover:bg-primary/25 transition-colors disabled:opacity-40"
            >
              {codeLoading ? "Loading…" : code ? "Hide code" : "Show code"}
            </button>
            {code && (
              <pre className="mt-2 max-h-[360px] overflow-auto rounded-md bg-black/40 border border-border p-3 text-[13px] leading-relaxed font-mono text-foreground/75 whitespace-pre">
                {code}
              </pre>
            )}
          </div>
        </div>

        {/* The Why view — condition→action first: the question the research
         * says developers actually ask (Pennington 1987; Sillito Q32). */}
        <div className="mb-4">
          <TriggerTree
            project={project}
            symbolId={bundle.node.id}
            onOpenSymbol={onOpenSymbol}
          />
        </div>

        {/* Connections */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <ConnectionList
            title="Called by"
            page={bundle.callers}
            homeRegion={bundle.region?.id}
            onLoadMore={() => setLimit((value) => value + 100)}
            onOpenSymbol={onOpenSymbol}
            onOpenWiki={onOpenWiki}
          />
          <ConnectionList
            title="Calls"
            page={bundle.callees}
            homeRegion={bundle.region?.id}
            onLoadMore={() => setLimit((value) => value + 100)}
            onOpenSymbol={onOpenSymbol}
            onOpenWiki={onOpenWiki}
          />
        </div>

        {/* If you change this — reverse reachability: the hypothetical blast
         * radius of an edit here, and the tests to run first. Non-callables
         * (File nodes, …) have no radius; the section stays hidden. */}
        {impactError && impactError !== "symbol is not an indexed callable" && (
          <p className="text-[13px] text-foreground/40 mb-4">
            Impact unavailable: {impactError}
          </p>
        )}
        {impact && (
          <div className="bg-card border border-border/40 rounded-md p-4 mb-4">
            <div className="flex items-baseline gap-2 mb-2">
              <p className="text-[12px] uppercase tracking-widest text-foreground/45">
                {t.impact.heading}
              </p>
              <span className="text-[12px] text-foreground/40">
                <MetricChip slug="blast-radius" onOpen={onOpenWiki} />
              </span>
            </div>
            <p className="text-[14px] text-foreground/85">
              {impactSentence(impact, t.impact)}
            </p>
            {impactTiers && (
              <p className="text-[12px] text-foreground/40 mt-1">{impactTiers}</p>
            )}
            {impact.regions.length > 0 && (
              <div className="flex flex-wrap items-baseline gap-1.5 mt-2">
                {impact.regions.map((region) => (
                  <span
                    key={region.name}
                    className="px-2 py-0.5 rounded-md text-[12px] bg-surface-3 text-foreground/60"
                  >
                    {region.name} ({region.count.toLocaleString("en-US")})
                  </span>
                ))}
                {impact.regions_more > 0 && (
                  <span className="text-[12px] text-foreground/40">
                    +{impact.regions_more.toLocaleString("en-US")} more
                  </span>
                )}
                {impact.unregioned > 0 && (
                  <span className="text-[12px] text-foreground/40">
                    +{impact.unregioned.toLocaleString("en-US")} unmapped
                  </span>
                )}
              </div>
            )}
            {impact.tests.count > 0 ? (
              <div className="mt-3">
                <p className="text-[12px] uppercase tracking-widest text-foreground/45 mb-1">
                  {t.impact.runTheseFirst}
                </p>
                <div className="space-y-px">
                  {impact.tests.nearest.map((test) => (
                    <button
                      key={test.id}
                      onClick={() => onOpenSymbol({ id: test.id })}
                      className="flex items-center gap-2 w-full text-left px-2 py-[3px] rounded-md hover:bg-surface-3 transition-colors group"
                    >
                      <span className="text-[13px] font-mono text-foreground/65 group-hover:text-primary truncate transition-colors">
                        {test.name}
                      </span>
                      <span className="text-[12px] text-foreground/35 truncate">
                        {test.file_path}
                      </span>
                      <span className="text-[12px] tabular-nums text-foreground/40 ml-auto shrink-0">
                        d {test.distance}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-[12px] text-foreground/40 mt-1">
                  {impact.tests.count.toLocaleString("en-US")} test
                  {impact.tests.count === 1 ? " reaches" : "s reach"} this symbol
                  {impact.tests.nearest.length < impact.tests.count &&
                    ` — showing ${impact.tests.nearest.length} of ${impact.tests.count.toLocaleString("en-US")}`}
                </p>
              </div>
            ) : (
              <p className="text-[13px] text-amber-300/80 mt-3">
                {t.impact.noTestReaches}
              </p>
            )}
            <p className="text-[12px] text-foreground/35 mt-3">
              {t.impact.basisFootnote}
            </p>
          </div>
        )}

        {/* Why & who — the rationale proxy and the knowledge map. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="bg-card border border-border/50 rounded-md p-4">
            <p className="text-[12px] uppercase tracking-widest text-foreground/40 mb-2">
              Recent changes to this file
            </p>
            {bundle.file_history?.available === false && (
              <p className="text-[13px] text-foreground/40">
                No git history readable for this project.
              </p>
            )}
            {bundle.file_history?.available &&
              (bundle.file_history.recent?.length ?? 0) === 0 && (
                <p className="text-[13px] text-foreground/40">
                  Untouched in the last year.
                </p>
              )}
            {(bundle.file_history?.recent ?? []).map((commit) => (
              <CommitRow
                key={commit.hash}
                commit={commit}
                remote={bundle.file_history?.remote_url}
              />
            ))}
            {bundle.file_history?.available &&
              (bundle.file_history.commits_1y ?? 0) > 0 && (
                <p className="text-[12px] text-foreground/40 mt-2">
                  {bundle.file_history.commits_1y?.toLocaleString("en-US")} commits in the
                  last year
                  {bundle.file_history.top_author &&
                    ` · mostly ${bundle.file_history.top_author} (${((bundle.file_history.top_author_share ?? 0) * 100).toFixed(0)}% of ${bundle.file_history.authors} author${(bundle.file_history.authors ?? 0) > 1 ? "s" : ""})`}
                </p>
              )}
          </div>
          {bundle.project_has_data_flows !== false && (
          <div className="bg-card border border-border/50 rounded-md p-4">
            <p className="text-[12px] uppercase tracking-widest text-foreground/40 mb-2">
              Data flows
            </p>
            {(["data_in", "data_out"] as const).map((direction) => {
              const flows: DataFlowRef[] = bundle[direction] ?? [];
              if (flows.length === 0) return null;
              return (
                <div key={direction} className="mb-2">
                  <p className="text-[12px] text-foreground/35 mb-1">
                    {direction === "data_in" ? "receives from" : "feeds into"}
                  </p>
                  {flows.map((flow) => (
                    <button
                      key={`${direction}-${flow.id}`}
                      onClick={() => onOpenSymbol({ id: flow.id })}
                      className="flex items-center gap-2 w-full text-left px-2 py-[3px] rounded-md hover:bg-surface-3 transition-colors group"
                    >
                      <span className="text-[13px] font-mono text-foreground/65 group-hover:text-primary truncate transition-colors">
                        {flow.name}
                      </span>
                      {flow.detail?.args !== undefined && (
                        <span className="text-[12px] font-mono text-foreground/35 truncate">
                          {String(flow.detail.args)}
                        </span>
                      )}
                      <span className="text-[12px] text-foreground/25 truncate ml-auto shrink-0 max-w-[38%]">
                        {flow.file_path}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
            {(bundle.data_in ?? []).length === 0 &&
              (bundle.data_out ?? []).length === 0 && (
                <p className="text-[13px] text-foreground/40">
                  No DATA_FLOWS edges touch this symbol.
                </p>
              )}
          </div>
          )}
        </div>

        {/* Why is this here? — the recorded rationale: on-demand git log -L
         * over this symbol's own line range, not the whole file's. */}
        {canTrace && (
          <div className="bg-card border border-border/50 rounded-md p-4 mb-4">
            <p className="text-[12px] uppercase tracking-widest text-foreground/40 mb-2">
              {t.history.whyHere}
            </p>
            {node.docstring && (
              <p className="text-[12px] text-foreground/40 mb-2">
                {t.history.docstringIntro}
              </p>
            )}
            {!history && (
              <button
                onClick={loadHistory}
                disabled={historyLoading}
                className="px-2.5 py-1 rounded-md bg-primary/15 text-primary text-[13px] font-medium hover:bg-primary/25 transition-colors disabled:opacity-40"
              >
                {t.history.trace}
              </button>
            )}
            {historyLoading && (
              <p className="text-[13px] text-foreground/40 mt-2">
                {t.history.reading}
              </p>
            )}
            {historyError && (
              <p className="text-[13px] text-foreground/40 mt-2">
                {t.history.unavailable(historyError)}
              </p>
            )}
            {history && !history.available && (
              <p className="text-[13px] text-foreground/40">
                {t.history.noneReadable}
              </p>
            )}
            {history?.available && (
              <>
                <div className="space-y-px">
                  {(history.commits ?? []).map((commit) => (
                    <CommitRow
                      key={commit.hash}
                      commit={commit}
                      remote={history.remote_url}
                    />
                  ))}
                </div>
                {(history.commits ?? []).length === 0 && (
                  <p className="text-[13px] text-foreground/40">
                    {t.history.noneForRange}
                  </p>
                )}
                {history.truncated && (
                  <p className="text-[12px] text-foreground/40 mt-1">
                    {t.history.capped(history.max_commits)}
                  </p>
                )}
              </>
            )}
            <p className="text-[12px] text-foreground/35 mt-3">
              {t.history.footnote}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-card border border-border/40 rounded-md p-4">
            <p className="text-[12px] uppercase tracking-widest text-foreground/45 mb-2">
              <MetricChip slug="tested" onOpen={onOpenWiki}>
                Tested by
              </MetricChip>
            </p>
            {(bundle.tests ?? []).map((test: SymbolRef) => (
              <button
                key={test.id}
                onClick={() => onOpenSymbol({ id: test.id })}
                className="block w-full text-left text-[13px] font-mono text-foreground/60 hover:text-primary py-[3px] truncate transition-colors"
              >
                {test.name}
              </button>
            ))}
            {(bundle.tests ?? []).length === 0 && (
              <p className="text-[13px] text-amber-300/50">No TESTS edges reach this symbol.</p>
            )}
          </div>

          <div className="bg-card border border-border/40 rounded-md p-4">
            <p className="text-[12px] uppercase tracking-widest text-foreground/45 mb-2">
              <MetricChip slug="co-change" onOpen={onOpenWiki}>
                Changes together with
              </MetricChip>
            </p>
            {(bundle.co_change ?? []).map((partner) => (
              <p key={partner.file_path} className="text-[13px] font-mono text-foreground/55 py-[3px] truncate">
                {partner.file_path}
                {partner.score !== undefined && (
                  <span className="text-foreground/40"> · {partner.score.toFixed(2)}</span>
                )}
              </p>
            ))}
            {(bundle.co_change ?? []).length === 0 && (
              <p className="text-[13px] text-foreground/40">No co-change history.</p>
            )}
          </div>

          <div className="bg-card border border-border/40 rounded-md p-4">
            <p className="text-[12px] uppercase tracking-widest text-foreground/45 mb-2">
              Near-clones
            </p>
            {(bundle.similar ?? []).map((clone) => (
              <button
                key={clone.id}
                onClick={() => onOpenSymbol({ id: clone.id })}
                className="block w-full text-left text-[13px] font-mono text-foreground/60 hover:text-primary py-[3px] truncate transition-colors"
              >
                {clone.name}
                {clone.score !== undefined && (
                  <span className="text-foreground/40"> · {clone.score.toFixed(2)}</span>
                )}
              </button>
            ))}
            {(bundle.similar ?? []).length === 0 && (
              <p className="text-[13px] text-foreground/40">No near-clones.</p>
            )}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
