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
import { AddToPromptButton } from "./PromptBasket";
import type { RepoInfo } from "../lib/types";

interface SymbolTabProps {
  project: string;
  symbolRef: { id?: number; qn?: string };
  onOpenSymbol: (ref: { id?: number; qn?: string }) => void;
  onOpenRegion: (regionId: number) => void;
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
  onLoadMore,
  onOpenSymbol,
}: {
  title: string;
  page: ConnectionPage;
  onLoadMore: () => void;
  onOpenSymbol: (ref: { id?: number; qn?: string }) => void;
}) {
  const shown = page.offset + page.items.length;
  return (
    <div className="bg-card border border-border/40 rounded-md p-4">
      <div className="flex items-baseline gap-2 mb-2">
        <p className="text-[12px] uppercase tracking-widest text-foreground/45">{title}</p>
        <span className="text-[13px] tabular-nums text-foreground/40">
          {page.total.toLocaleString("en-US")}
        </span>
        <span className="text-[12px] text-foreground/40 ml-auto">
          {Object.entries(page.by_type)
            .map(([type, count]) => `${CONFIDENCE[type]?.label ?? type.toLowerCase()} ${count}`)
            .join(" · ")}
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
        <button
          onClick={onLoadMore}
          className="mt-1.5 px-2 text-[12px] text-primary/70 hover:text-primary transition-colors"
        >
          Show more ({(page.total - shown).toLocaleString("en-US")} hidden)
        </button>
      )}
    </div>
  );
}

export function SymbolTab({ project, symbolRef, onOpenSymbol, onOpenRegion }: SymbolTabProps) {
  const [bundle, setBundle] = useState<SymbolBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);
  const [code, setCode] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBundle(null);
    setError(null);
    setCode(null);
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

        {/* Connections */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <ConnectionList
            title="Called by"
            page={bundle.callers}
            onLoadMore={() => setLimit((value) => value + 100)}
            onOpenSymbol={onOpenSymbol}
          />
          <ConnectionList
            title="Calls"
            page={bundle.callees}
            onLoadMore={() => setLimit((value) => value + 100)}
            onOpenSymbol={onOpenSymbol}
          />
        </div>

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
              <div key={commit.hash} className="flex items-baseline gap-2 py-[3px]">
                <span className="text-[12px] font-mono text-foreground/35 shrink-0">
                  {commit.hash}
                </span>
                <span className="text-[13px] text-foreground/70 truncate flex-1">
                  {commit.subject}
                </span>
                <span className="text-[12px] text-foreground/35 shrink-0">
                  {commit.author} ·{" "}
                  {new Date(commit.time * 1000).toISOString().slice(0, 10)}
                </span>
              </div>
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
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-card border border-border/40 rounded-md p-4">
            <p className="text-[12px] uppercase tracking-widest text-foreground/45 mb-2">
              Tested by
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
              Changes together with
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
