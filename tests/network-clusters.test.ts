import { describe, it, expect } from "vitest";
import {
  sliceNetwork,
  clusterColor,
  CLUSTER_COLORS,
  DEFAULT_MIN_STRENGTH,
} from "@/lib/graph/clusters";
import type { GraphData, GraphNode } from "@/lib/graph/types";

function item(id: string): GraphNode {
  return { id: `item:${id}`, type: "item", label: id };
}
function actor(name: string): GraphNode {
  return { id: `adv:${name}`, type: "adversary", label: name };
}
/** A report-to-report connection of the given strength. */
function link(a: string, b: string, weight: number) {
  return { id: `e:${a}-${b}`, source: `item:${a}`, target: `item:${b}`, weight };
}
/** An actor tie, which carries no strength of its own. */
function tie(itemId: string, name: string) {
  return { id: `t:${itemId}-${name}`, source: `item:${itemId}`, target: `adv:${name}` };
}

// Two clusters: A-B-C bound tightly, D-E loosely.
const graph: GraphData = {
  nodes: [item("a"), item("b"), item("c"), item("d"), item("e"), actor("Wicked Panda")],
  edges: [
    link("a", "b", 9),
    link("b", "c", 4),
    link("d", "e", 2),
    tie("a", "Wicked Panda"),
    tie("d", "Wicked Panda"),
  ],
};

describe("sliceNetwork", () => {
  it("keeps only connections at or above the threshold", () => {
    const slice = sliceNetwork(graph, 3);
    expect(slice.links).toBe(2);
    expect(slice.nodeIds.has("item:d")).toBe(false);
    expect(slice.nodeIds.has("item:e")).toBe(false);
  });

  it("groups what survives into clusters", () => {
    expect(sliceNetwork(graph, 1).clusters).toBe(1); // the actor tie joins them
    expect(sliceNetwork(graph, 3).clusters).toBe(1);
    expect(sliceNetwork(graph, 5).clusters).toBe(1); // only a-b left
    expect(sliceNetwork(graph, 20).nodeIds.size).toBe(0);
  });

  it("splits a cluster when the link holding it together goes", () => {
    const split: GraphData = {
      nodes: [item("a"), item("b"), item("c"), item("d")],
      edges: [link("a", "b", 8), link("b", "c", 2), link("c", "d", 8)],
    };
    expect(sliceNetwork(split, 1).clusters).toBe(1);
    const cut = sliceNetwork(split, 3);
    expect(cut.clusters).toBe(2);
    // ...and the two halves must not go on sharing a colour.
    expect(cut.colorOf.get("item:a")).not.toBe(cut.colorOf.get("item:d"));
  });

  // An attribution in common is a fact about the reporting, not evidence that
  // two campaigns are the same one.
  it("does not let an actor tie rescue a report the threshold dropped", () => {
    const slice = sliceNetwork(graph, 3);
    expect(slice.nodeIds.has("item:d")).toBe(false);
    expect(slice.edgeIds.has("t:d-Wicked Panda")).toBe(false);
    // The tie to a report that did survive stays.
    expect(slice.edgeIds.has("t:a-Wicked Panda")).toBe(true);
  });

  it("counts reports and actors separately, and only what is drawn", () => {
    const slice = sliceNetwork(graph, 3);
    expect(slice.reports).toBe(3); // a, b, c
    expect(slice.actors).toBe(1);
  });

  it("gives every node in a cluster the same colour", () => {
    const slice = sliceNetwork(graph, 3);
    const c = slice.colorOf.get("item:a");
    expect(c).toBeTruthy();
    for (const id of ["item:b", "item:c", "adv:Wicked Panda"])
      expect(slice.colorOf.get(id)).toBe(c);
  });

  it("colours the biggest cluster first, so the same graph always looks the same", () => {
    const twice = [sliceNetwork(graph, 3), sliceNetwork(graph, 3)];
    expect(twice[0].colorOf.get("item:a")).toBe(twice[1].colorOf.get("item:a"));
    expect(twice[0].colorOf.get("item:a")).toBe(CLUSTER_COLORS[0]);
  });

  it("survives an empty graph", () => {
    for (const g of [null, { nodes: [], edges: [] }]) {
      const slice = sliceNetwork(g, DEFAULT_MIN_STRENGTH);
      expect(slice.clusters).toBe(0);
      expect(slice.nodeIds.size).toBe(0);
    }
  });
});

describe("clusterColor", () => {
  it("cycles rather than running out", () => {
    expect(clusterColor(0)).toBe(CLUSTER_COLORS[0]);
    expect(clusterColor(CLUSTER_COLORS.length)).toBe(CLUSTER_COLORS[0]);
    expect(clusterColor(CLUSTER_COLORS.length + 2)).toBe(CLUSTER_COLORS[2]);
  });

  // Amber is the actor ties; a cluster wearing it would read as one.
  it("leaves the actor tie's amber out of the palette", () => {
    expect(CLUSTER_COLORS).not.toContain("#fbbf24");
  });
});
