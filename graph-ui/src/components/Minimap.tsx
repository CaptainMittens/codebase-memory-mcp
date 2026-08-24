import { useMemo, useState } from "react";
import type { Region } from "../lib/types";

/* The 2D synced panel of the orientation triad: every region as a colored
 * dot on a fixed top-down projection, so the 3D view always has a stable
 * "you are here" companion. Click a dot to open that region. */

export interface MinimapDot {
  id: number;
  cx: number;
  cy: number;
  r: number;
  color: string;
  name: string;
}

export function minimapLayout(
  regions: Region[],
  width: number,
  height: number,
  pad = 12,
): MinimapDot[] {
  if (regions.length === 0) return [];
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const region of regions) {
    minX = Math.min(minX, region.x);
    maxX = Math.max(maxX, region.x);
    minY = Math.min(minY, region.y);
    maxY = Math.max(maxY, region.y);
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const maxMembers = Math.max(...regions.map((region) => region.members), 1);
  return regions.map((region) => ({
    id: region.id,
    cx: pad + ((region.x - minX) / spanX) * (width - pad * 2),
    cy: pad + ((region.y - minY) / spanY) * (height - pad * 2),
    r: 3 + 7 * Math.sqrt(region.members / maxMembers),
    color: region.color,
    name: region.name,
  }));
}

const W = 190;
const H = 150;

export function Minimap({
  regions,
  openRegionId,
  scentCounts,
  onOpen,
  onHome,
}: {
  regions: Region[];
  openRegionId: number | null;
  scentCounts: Map<number, number> | null;
  onOpen: (region: Region) => void;
  onHome: () => void;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("cbm-minimap-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const dots = useMemo(() => minimapLayout(regions, W, H), [regions]);
  const byId = useMemo(() => new Map(regions.map((r) => [r.id, r])), [regions]);

  const toggle = () => {
    setCollapsed((v) => {
      try {
        localStorage.setItem("cbm-minimap-collapsed", v ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !v;
    });
  };

  if (regions.length === 0) return null;
  return (
    <div className="absolute bottom-4 right-4 bg-card/85 backdrop-blur border border-border/50 rounded-md shadow-lg overflow-hidden">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border/30">
        <span className="text-[12px] uppercase tracking-widest text-foreground/40">
          map
        </span>
        <button
          onClick={onHome}
          title="Fit everything in view"
          className="ml-auto text-foreground/45 hover:text-foreground/80 text-[13px] leading-none px-1 transition-colors"
        >
          ⌂
        </button>
        <button
          onClick={toggle}
          title={collapsed ? "Expand map" : "Collapse map"}
          className="text-foreground/45 hover:text-foreground/80 text-[13px] leading-none px-1 transition-colors"
        >
          {collapsed ? "▴" : "▾"}
        </button>
      </div>
      {!collapsed && (
        <svg width={W} height={H} role="img" aria-label="Region minimap">
          {dots.map((dot) => {
            const isOpen = dot.id === openRegionId;
            const hits = scentCounts?.get(dot.id) ?? 0;
            return (
              <g
                key={dot.id}
                onClick={() => {
                  const region = byId.get(dot.id);
                  if (region) onOpen(region);
                }}
                className="cursor-pointer"
              >
                <title>{dot.name}</title>
                <circle
                  cx={dot.cx}
                  cy={dot.cy}
                  r={dot.r}
                  fill={dot.color}
                  fillOpacity={scentCounts && hits === 0 ? 0.25 : 0.85}
                  stroke={isOpen ? "#4FA8E0" : "none"}
                  strokeWidth={isOpen ? 2 : 0}
                />
                {hits > 0 && (
                  <text
                    x={dot.cx}
                    y={dot.cy - dot.r - 2}
                    textAnchor="middle"
                    fontSize="9"
                    fill="#4FA8E0"
                    className="tabular-nums"
                  >
                    {hits}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
