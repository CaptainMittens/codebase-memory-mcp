import { Html } from "@react-three/drei";
import type { GraphNode, Region } from "../lib/types";
import { cohesionWord } from "../lib/regions";

/* Hover card for a region blob in the coarsest galaxy view: what a human
 * needs before deciding to drill — size, cohesion in words, the hub. */
export function RegionTooltip({ region, node }: { region: Region; node: GraphNode }) {
  return (
    <Html
      position={[node.x, node.y + node.size * 0.7, node.z]}
      center
      style={{ pointerEvents: "none" }}
    >
      <div className="bg-popover/95 backdrop-blur border border-border/60 rounded-md px-3 py-2 text-xs whitespace-nowrap shadow-xl max-w-[360px]">
        <div className="flex items-center gap-1.5 mb-1">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: region.color }}
          />
          <span className="text-foreground font-medium truncate">{region.name}</span>
        </div>
        <p className="text-foreground/50 tabular-nums">
          {region.members.toLocaleString("en-US")} symbols ·{" "}
          {region.files.toLocaleString("en-US")} files ·{" "}
          {cohesionWord(region.cohesion)} ({region.cohesion.toFixed(2)})
        </p>
        {region.hub && (
          <p className="text-foreground/45 font-mono truncate mt-0.5">hub: {region.hub}</p>
        )}
        <p className="text-foreground/35 mt-1 text-[12px]">double-click to open →</p>
      </div>
    </Html>
  );
}
