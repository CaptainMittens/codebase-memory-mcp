/* Overview — the first read of a project: freshness, the map of regions,
 * hubs, entry points, boundaries, surprising couplings and suggested
 * questions. Everything deterministic, everything with a why, everything
 * one click from detail or from the prompt composer. */
import { useEffect, useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchArchitecture, archRows, type ArchitectureJson } from "../lib/atlas";
import { fetchRegions } from "../hooks/useGraphData";
import { disambiguateRegionNames } from "../lib/regions";
import { surprisingCouplings, suggestedQuestions } from "../lib/firstread";
import { AddToPromptButton } from "./PromptBasket";
import type { RegionsPayload } from "../lib/types";

interface OverviewTabProps {
  project: string;
  onOpenRegion: (regionId: number) => void;
  onOpenSymbol: (qn: string) => void;
  onOpenModules: () => void;
  onOpenFlows: () => void;
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

function shortQn(qn: string): string {
  const parts = qn.split(".");
  return parts.slice(-2).join(".");
}

function Card({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`bg-white/[0.02] border border-border/40 rounded-xl p-4 ${wide ? "col-span-full" : ""}`}>
      <p className="text-[10px] uppercase tracking-widest text-foreground/30 mb-3">{title}</p>
      {children}
    </div>
  );
}

export function OverviewTab({
  project,
  onOpenRegion,
  onOpenSymbol,
  onOpenModules,
  onOpenFlows,
}: OverviewTabProps) {
  const [arch, setArch] = useState<ArchitectureJson | null>(null);
  const [regions, setRegions] = useState<RegionsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setArch(null);
    setRegions(null);
    setError(null);
    Promise.allSettled([fetchArchitecture(project), fetchRegions(project)]).then(
      ([archResult, regionsResult]) => {
        if (cancelled) return;
        if (archResult.status === "fulfilled") setArch(archResult.value);
        if (regionsResult.status === "fulfilled") setRegions(regionsResult.value);
        if (archResult.status === "rejected" && regionsResult.status === "rejected")
          setError(String(archResult.reason?.message ?? "failed to load"));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [project]);

  const displayRegions = useMemo(
    () => (regions ? disambiguateRegionNames(regions.regions) : []),
    [regions],
  );
  const couplings = useMemo(() => (regions ? surprisingCouplings(regions, 4) : []), [regions]);
  const questions = useMemo(() => (regions ? suggestedQuestions(regions, {}, 4) : []), [regions]);

  const hotspots = useMemo(() => archRows<HotspotRow>(arch, "hotspots"), [arch]);
  const entries = useMemo(() => archRows<EntryRow>(arch, "entry_points"), [arch]);
  const boundaries = useMemo(() => archRows<BoundaryRow>(arch, "boundaries"), [arch]);
  const languages = useMemo(() => archRows<LanguageRow>(arch, "languages"), [arch]);
  const totalNodes = typeof arch?.total_nodes === "number" ? arch.total_nodes : regions?.total_nodes;
  const totalEdges = typeof arch?.total_edges === "number" ? arch.total_edges : undefined;

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-red-400/80 text-sm">{error}</p>
      </div>
    );
  }
  if (!arch && !regions) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-white/30 text-sm">Reading the map…</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="max-w-[1200px] mx-auto px-6 py-6">
        {/* Header numbers */}
        <div className="flex flex-wrap gap-6 mb-6">
          {[
            { label: "Symbols", value: totalNodes?.toLocaleString("en-US") ?? "…" },
            { label: "Edges", value: totalEdges?.toLocaleString("en-US") ?? "…" },
            { label: "Regions", value: displayRegions.length || "…" },
            {
              label: "Languages",
              value:
                languages
                  .slice(0, 3)
                  .map((lang) => lang.language)
                  .join(" · ") || "…",
            },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="text-[9px] uppercase tracking-widest text-foreground/25">{stat.label}</p>
              <p className="text-[17px] font-semibold text-foreground/90 tabular-nums">
                {stat.value}
              </p>
            </div>
          ))}
          {regions && regions.unmapped_nodes > 0 && (
            <div>
              <p className="text-[9px] uppercase tracking-widest text-foreground/25">Unmapped</p>
              <p className="text-[17px] font-semibold text-amber-300/70 tabular-nums">
                {regions.unmapped_nodes.toLocaleString("en-US")}
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Regions — the map */}
          <Card title={`Regions — the de-facto modules (${regions?.method ?? "…"})`} wide>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {displayRegions.slice(0, 12).map((region) => (
                <button
                  key={region.id}
                  onClick={() => onOpenRegion(region.id)}
                  className="text-left rounded-lg border border-border/30 bg-white/[0.02] hover:bg-white/[0.05] hover:border-primary/30 p-3 transition-all group"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: region.color }}
                    />
                    <span className="text-[12px] font-medium text-foreground/80 truncate group-hover:text-primary transition-colors">
                      {region.name}
                    </span>
                  </div>
                  <p className="text-[10px] text-foreground/30 truncate">
                    {region.members.toLocaleString("en-US")} symbols · cohesion{" "}
                    {region.cohesion.toFixed(2)}
                  </p>
                  {region.why && (
                    <p className="text-[10px] text-foreground/25 mt-1 line-clamp-2">{region.why}</p>
                  )}
                </button>
              ))}
            </div>
            {displayRegions.length > 12 && (
              <button
                onClick={onOpenModules}
                className="mt-2 text-[11px] text-primary/70 hover:text-primary transition-colors"
              >
                all {displayRegions.length} regions in Modules →
              </button>
            )}
          </Card>

          {/* Hubs */}
          <Card title="Hubs — highest fan-in">
            <div className="space-y-px">
              {hotspots.slice(0, 8).map((hotspot) => (
                <div key={hotspot.qn} className="flex items-center gap-2 py-[3px]">
                  <button
                    onClick={() => onOpenSymbol(hotspot.qn)}
                    className="text-[11px] font-mono text-foreground/60 hover:text-primary truncate flex-1 text-left transition-colors"
                    title={hotspot.qn}
                  >
                    {shortQn(hotspot.qn)}
                  </button>
                  <span className="text-[10px] tabular-nums text-foreground/30 shrink-0">
                    {Number(hotspot.fan_in).toLocaleString("en-US")}
                  </span>
                </div>
              ))}
              {hotspots.length === 0 && (
                <p className="text-[11px] text-foreground/25">No hotspot data.</p>
              )}
            </div>
          </Card>

          {/* Start here */}
          <Card title="Start here — entry points">
            <div className="space-y-px">
              {entries.slice(0, 8).map((entry) => (
                <button
                  key={entry.qn}
                  onClick={() => onOpenSymbol(entry.qn)}
                  className="flex items-center gap-2 w-full text-left py-[3px] group"
                  title={entry.qn}
                >
                  <span className="text-[11px] font-mono text-foreground/60 group-hover:text-primary truncate transition-colors">
                    {shortQn(entry.qn)}
                  </span>
                  <span className="text-[10px] text-foreground/20 truncate ml-auto shrink-0 max-w-[40%]">
                    {entry.file}
                  </span>
                </button>
              ))}
              {entries.length === 0 && (
                <p className="text-[11px] text-foreground/25">No entry points detected.</p>
              )}
            </div>
            <button
              onClick={onOpenFlows}
              className="mt-2 text-[11px] text-primary/70 hover:text-primary transition-colors"
            >
              follow them in Flows →
            </button>
          </Card>

          {/* Surprising couplings */}
          <Card title="Surprising couplings — with reasons">
            <div className="space-y-2">
              {couplings.map((coupling) => (
                <div key={`${coupling.source.id}-${coupling.target.id}`}>
                  <p className="text-[11.5px] text-foreground/70">
                    <span className="font-medium">{coupling.source.name}</span>
                    <span className="text-foreground/30"> ⇄ </span>
                    <span className="font-medium">{coupling.target.name}</span>
                  </p>
                  <p className="text-[10px] text-foreground/30">{coupling.reasons.join(" · ")}</p>
                </div>
              ))}
              {couplings.length === 0 && (
                <p className="text-[11px] text-foreground/25">
                  No cross-region couplings stand out.
                </p>
              )}
            </div>
          </Card>

          {/* Suggested questions */}
          <Card title="Questions this graph can answer — ask your agent">
            <div className="space-y-2">
              {questions.map((question) => (
                <div key={question.question} className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[11.5px] text-foreground/70">{question.question}</p>
                    <p className="text-[10px] text-foreground/30">{question.why}</p>
                  </div>
                  <AddToPromptButton
                    small
                    item={{ kind: "question", question: question.question, why: question.why }}
                  />
                </div>
              ))}
              {questions.length === 0 && (
                <p className="text-[11px] text-foreground/25">Nothing stands out structurally.</p>
              )}
            </div>
          </Card>

          {/* Boundaries */}
          <Card title="Boundaries — who calls across packages" wide>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-[9px] uppercase tracking-wider text-foreground/25">
                    <th className="py-1 pr-4 font-medium">from</th>
                    <th className="py-1 pr-4 font-medium">to</th>
                    <th className="py-1 text-right font-medium">calls</th>
                  </tr>
                </thead>
                <tbody>
                  {boundaries.slice(0, 8).map((boundary, index) => (
                    <tr key={index} className="border-t border-border/20">
                      <td className="py-1 pr-4 font-mono text-foreground/60">{boundary.from}</td>
                      <td className="py-1 pr-4 font-mono text-foreground/60">{boundary.to}</td>
                      <td className="py-1 text-right tabular-nums text-foreground/40">
                        {Number(boundary.calls).toLocaleString("en-US")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {boundaries.length === 0 && (
                <p className="text-[11px] text-foreground/25">No cross-package calls recorded.</p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </ScrollArea>
  );
}
