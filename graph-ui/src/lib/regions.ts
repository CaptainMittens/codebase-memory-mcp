/* Region level of detail — adapters between the level=regions payload
 * (layout_regions.c) and the node/edge shapes the 3D scene renders. */
import type { GraphData, GraphNode, Region, RegionsPayload } from "./types";

/* The scene renders GraphNodes; a region becomes one body. Region ids live in
 * a separate id space from node ids — the scene never mixes the two levels,
 * so collisions are impossible by construction. */
export function regionToNode(region: Region): GraphNode {
  return {
    id: region.id,
    x: region.x,
    y: region.y,
    z: region.z,
    label: "Region",
    name: region.name,
    size: region.size,
    color: region.color,
    status: "structural",
    in_calls: 0,
  };
}

/* Duplicate display names (two Leiden communities dominated by the same
 * folder) get their hub appended so the human can tell them apart. */
export function disambiguateRegionNames(regions: Region[]): Region[] {
  const counts = new Map<string, number>();
  for (const region of regions) {
    counts.set(region.name, (counts.get(region.name) ?? 0) + 1);
  }
  return regions.map((region) =>
    (counts.get(region.name) ?? 0) > 1 && region.hub
      ? { ...region, name: `${region.name} · ${region.hub}` }
      : region,
  );
}

/* GraphData for the scene: bodies + weighted arcs (type "REGION"). */
export function regionsToGraphData(payload: RegionsPayload): GraphData {
  const regions = disambiguateRegionNames(payload.regions);
  return {
    nodes: regions.map(regionToNode),
    edges: payload.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      type: "REGION",
    })),
    total_nodes: payload.total_nodes,
  };
}

/* Below this project size the region level adds a hop without teaching
 * anything — the full galaxy is already readable and loads fast. */
export const REGIONS_MIN_TOTAL_NODES = 5000;

export function regionsViewWorthwhile(payload: RegionsPayload): boolean {
  return (
    payload.total_nodes > REGIONS_MIN_TOTAL_NODES && payload.regions.length > 1
  );
}
