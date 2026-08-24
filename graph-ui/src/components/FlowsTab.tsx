/* Flows — how the codebase runs: ranked entry→terminal call journeys, each
 * opening as an indented call tree with every step one click from its
 * symbol page. Truncation is stated, never silent. */
import { useEffect, useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  fetchFlow,
  fetchFlows,
  type FlowDetail,
  type FlowsPayload,
} from "../lib/atlas";
import { AddToPromptButton } from "./PromptBasket";

interface FlowsTabProps {
  project: string;
  flowId: number | null;
  onOpenFlow: (id: number | null) => void;
  onOpenSymbol: (ref: { id?: number; qn?: string }) => void;
}

function flowToMermaid(detail: FlowDetail): string {
  const lines = ["graph TD"];
  for (let index = 1; index < detail.steps.length; index++) {
    const step = detail.steps[index];
    const parent = detail.steps[step.parent];
    if (!parent) continue;
    const safe = (name: string) => name.replace(/[^A-Za-z0-9_]/g, "_");
    lines.push(`  ${safe(parent.name)}${step.parent} --> ${safe(step.name)}${index}`);
  }
  return lines.join("\n");
}

export function FlowsTab({ project, flowId, onOpenFlow, onOpenSymbol }: FlowsTabProps) {
  const [payload, setPayload] = useState<FlowsPayload | null>(null);
  const [detail, setDetail] = useState<FlowDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPayload(null);
    setError(null);
    fetchFlows(project)
      .then((flows) => {
        if (!cancelled) setPayload(flows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "failed");
      });
    return () => {
      cancelled = true;
    };
  }, [project]);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    if (flowId === null) return;
    fetchFlow(project, flowId)
      .then((flow) => {
        if (!cancelled) setDetail(flow);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project, flowId]);

  const grouped = useMemo(() => {
    const flows = payload?.flows ?? [];
    return {
      cross: flows.filter((flow) => flow.cross_region),
      intra: flows.filter((flow) => !flow.cross_region),
    };
  }, [payload]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-red-400/80 text-sm">{error}</p>
      </div>
    );
  }
  if (!payload) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-foreground/45 text-sm">Tracing the journeys…</p>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* Flow list */}
      <div className="w-[380px] shrink-0 border-r border-border/40 flex flex-col bg-card/60">
        <div className="px-4 py-3 border-b border-border/30 shrink-0">
          <p className="text-[12px] uppercase tracking-widest text-foreground/45">
            Flows — entry → terminal
          </p>
          <p className="text-[12px] text-foreground/45 mt-1">
            {payload.flows.length} journeys from{" "}
            {payload.callable_total.toLocaleString("en-US")} callables
            {payload.candidates_dropped > 0 &&
              ` · ${payload.candidates_dropped.toLocaleString("en-US")} candidates not walked`}
          </p>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="py-1">
            {(["cross", "intra"] as const).map((groupKey) => {
              const flows = grouped[groupKey];
              if (flows.length === 0) return null;
              return (
                <div key={groupKey}>
                  <p className="px-4 pt-2 pb-1 text-[12px] uppercase tracking-widest text-foreground/40">
                    {groupKey === "cross" ? "across regions" : "within one region"}
                  </p>
                  {flows.map((flow) => (
                    <button
                      key={flow.id}
                      onClick={() => onOpenFlow(flow.id)}
                      className={`flex items-center gap-2 w-full text-left px-4 py-[6px] transition-colors ${
                        flowId === flow.id
                          ? "bg-primary/10 text-primary"
                          : "text-foreground/60 hover:text-foreground/85 hover:bg-surface-3"
                      }`}
                    >
                      <span className="text-[13px] font-mono truncate flex-1">{flow.label}</span>
                      <span className="text-[12px] tabular-nums text-foreground/40 shrink-0">
                        {flow.steps}
                      </span>
                      {!flow.sink_terminated && (
                        <span className="text-[12px] text-foreground/35 shrink-0" title="walk stopped at the depth cap, not at a sink">
                          …
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              );
            })}
            {payload.flows.length === 0 && (
              <p className="text-[13px] text-foreground/40 px-4 py-4">
                No flows detected — the project may have no clear entry points.
              </p>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Flow detail */}
      <div className="flex-1 min-w-0">
        {flowId === null || !detail ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-foreground/45 text-sm">
              {flowId === null ? "Pick a journey on the left" : "Loading…"}
            </p>
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="px-6 py-5 max-w-[900px]">
              <div className="flex items-center gap-3 flex-wrap mb-1">
                <h3 className="text-[16px] font-semibold font-mono text-foreground/90">
                  {detail.entry.name}
                  <span className="text-foreground/45"> → </span>
                  {detail.terminal.name}
                </h3>
                <AddToPromptButton
                  item={{
                    kind: "flow",
                    id: detail.id,
                    label: `${detail.entry.name} → ${detail.terminal.name}`,
                    steps: detail.steps.length,
                  }}
                />
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(flowToMermaid(detail)).then(() => setCopied(true));
                  }}
                  className="px-2.5 py-1 rounded-md bg-surface-3 text-foreground/60 text-[13px] font-medium hover:bg-surface-4 transition-colors"
                >
                  {copied ? "Copied ✓" : "Copy as mermaid"}
                </button>
              </div>
              <p className="text-[13px] text-foreground/50 mb-4">
                {detail.steps.length} steps
                {detail.sink_terminated ? " · ends at a sink" : " · stopped at the depth cap"}
                {detail.cross_region ? " · crosses regions" : ""}
                {detail.steps_capped
                  ? ` · ${detail.steps_capped} branches beyond the cap not shown`
                  : ""}
              </p>

              <div className="space-y-px">
                {detail.steps.map((step, index) => (
                  <button
                    key={index}
                    onClick={() => onOpenSymbol({ id: step.id })}
                    className="flex items-center gap-2 w-full text-left py-[3.5px] rounded-md hover:bg-surface-3 transition-colors group"
                    style={{ paddingLeft: `${step.depth * 22 + 8}px` }}
                  >
                    <span className="text-foreground/35 text-[12px] shrink-0">
                      {step.depth === 0 ? "▶" : "└"}
                    </span>
                    <span className="text-[12px] font-mono text-foreground/70 group-hover:text-primary transition-colors truncate">
                      {step.name}
                    </span>
                    <span className="text-[12px] text-foreground/35 truncate ml-auto shrink-0 max-w-[40%]">
                      {step.file_path}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
