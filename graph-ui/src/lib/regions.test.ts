import { describe, expect, it } from "vitest";
import {
  disambiguateRegionNames,
  regionsToGraphData,
  regionsViewWorthwhile,
  REGIONS_MIN_TOTAL_NODES,
} from "./regions";
import type { Region, RegionsPayload } from "./types";

function region(partial: Partial<Region> & { id: number; name: string }): Region {
  return {
    files: 2,
    members: 10,
    cohesion: 0.5,
    top_nodes: ["a"],
    x: 0,
    y: 0,
    z: 0,
    size: 20,
    color: "#123456",
    ...partial,
  };
}

function payload(regions: Region[], total = 10000): RegionsPayload {
  return {
    level: "regions",
    method: "leiden+folders",
    total_nodes: total,
    unmapped_nodes: 0,
    regions,
    edges: [{ source: 0, target: 1, weight: 3 }],
  };
}

describe("region adapters", () => {
  it("appends the hub to duplicate display names", () => {
    const out = disambiguateRegionNames([
      region({ id: 0, name: "django/db", hub: "join" }),
      region({ id: 1, name: "django/db", hub: "get_field" }),
      region({ id: 2, name: "django/core", hub: "call_command" }),
    ]);
    expect(out.map((r) => r.name)).toEqual([
      "django/db · join",
      "django/db · get_field",
      "django/core",
    ]);
  });

  it("adapts regions to scene nodes and REGION edges", () => {
    const data = regionsToGraphData(
      payload([region({ id: 0, name: "a" }), region({ id: 1, name: "b" })]),
    );
    expect(data.nodes).toHaveLength(2);
    expect(data.nodes[0].label).toBe("Region");
    expect(data.edges).toEqual([{ source: 0, target: 1, type: "REGION" }]);
    expect(data.total_nodes).toBe(10000);
  });

  it("skips the region scene for small or single-region projects", () => {
    const two = [region({ id: 0, name: "a" }), region({ id: 1, name: "b" })];
    expect(regionsViewWorthwhile(payload(two, REGIONS_MIN_TOTAL_NODES))).toBe(false);
    expect(regionsViewWorthwhile(payload(two, REGIONS_MIN_TOTAL_NODES + 1))).toBe(true);
    expect(
      regionsViewWorthwhile(payload([region({ id: 0, name: "a" })], 99999)),
    ).toBe(false);
  });
});
