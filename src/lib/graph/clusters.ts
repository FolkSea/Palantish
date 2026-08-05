// What the report network shows at a given strength threshold, and which
// cluster each surviving node belongs to.
//
// Pure, so the answer is the same whether it is being counted for the panel or
// painted onto the canvas - the two used to be worked out separately, and a
// count that disagrees with the picture is worse than no count.

import type { GraphData } from "./types";

/**
 * One colour per cluster, in assignment order.
 *
 * Distinct hues rather than a gradient: adjacent clusters are unrelated, so
 * neighbouring colours should not suggest otherwise. Amber is left out - the
 * dashed actor ties own it - and so are the near-greys, which read as
 * "unremarkable" against the white canvas.
 */
export const CLUSTER_COLORS = [
  "#2563eb", // blue
  "#059669", // emerald
  "#7c3aed", // violet
  "#db2777", // pink
  "#0891b2", // cyan
  "#65a30d", // lime
  "#e11d48", // rose
  "#4f46e5", // indigo
  "#0d9488", // teal
  "#c026d3", // fuchsia
  "#0369a1", // sky
  "#15803d", // green
  "#9333ea", // purple
  "#be123c", // crimson
];

/**
 * Where the strength slider starts.
 *
 * At 1 every pair that has ever shared a single indicator is drawn - most of
 * the corpus, and a hairball. 3 is where the shape of the reporting shows
 * through; the slider still goes down to 1 for anyone who wants everything.
 */
export const DEFAULT_MIN_STRENGTH = 3;

/** The colour for the nth cluster. Cycles once the palette runs out. */
export function clusterColor(index: number): string {
  return CLUSTER_COLORS[index % CLUSTER_COLORS.length];
}

export type NetworkSlice = {
  /** Node ids still on the canvas. */
  nodeIds: Set<string>;
  /** Edge ids still on the canvas. */
  edgeIds: Set<string>;
  /** Cluster colour, by node id and by edge id. */
  colorOf: Map<string, string>;
  clusters: number;
  reports: number;
  actors: number;
  /** Report-to-report connections shown; actor ties are not counted. */
  links: number;
};

class DisjointSet {
  private parent = new Map<string, string>();

  find(x: string): string {
    const p = this.parent.get(x);
    if (p === undefined) {
      this.parent.set(x, x);
      return x;
    }
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * The graph as it appears at `minStrength`, grouped into clusters.
 *
 * A connection survives when it is at least that strong; an actor tie has no
 * strength of its own and rides on whether its report survived. A node with
 * nothing left attached is not drawn - a lone dot is not a finding.
 *
 * Clusters are numbered largest first so the biggest structures keep the most
 * distinct colours, and ties are broken by the lowest node id so the same graph
 * always colours the same way.
 */
export function sliceNetwork(
  graph: GraphData | null,
  minStrength: number,
): NetworkSlice {
  const empty: NetworkSlice = {
    nodeIds: new Set(),
    edgeIds: new Set(),
    colorOf: new Map(),
    clusters: 0,
    reports: 0,
    actors: 0,
    links: 0,
  };
  if (!graph) return empty;

  const isActorTie = (weight: number | undefined) => weight === undefined;
  const strongEnough = (weight: number | undefined) =>
    isActorTie(weight) ? false : (weight as number) >= minStrength;

  // A report survives on its own connections. Actor ties then follow the
  // reports that made it, so an actor cannot drag a report back onto a canvas
  // its own evidence was too weak for.
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const kept: { id: string; source: string; target: string }[] = [];
  for (const e of graph.edges) {
    if (!strongEnough(e.weight)) continue;
    edgeIds.add(e.id);
    kept.push(e);
    nodeIds.add(e.source);
    nodeIds.add(e.target);
  }
  const links = kept.length;

  // Only reports can survive on their own evidence, so this is exactly the set
  // of reports still on the canvas. It is taken before any actor is added,
  // because an actor that had already been let in would otherwise vouch for
  // the next report on its list and undo the threshold.
  const survivingReports = new Set(nodeIds);

  for (const e of graph.edges) {
    if (!isActorTie(e.weight)) continue;
    // One end is the actor, the other the report; keep the tie only when the
    // report is still here.
    if (!survivingReports.has(e.source) && !survivingReports.has(e.target))
      continue;
    edgeIds.add(e.id);
    kept.push(e);
    nodeIds.add(e.source);
    nodeIds.add(e.target);
  }

  const ds = new DisjointSet();
  for (const id of nodeIds) ds.find(id);
  for (const e of kept) ds.union(e.source, e.target);

  const members = new Map<string, string[]>();
  for (const id of nodeIds) {
    const root = ds.find(id);
    const list = members.get(root);
    if (list) list.push(id);
    else members.set(root, [id]);
  }

  const ordered = [...members.values()].sort(
    (a, b) => b.length - a.length || [...a].sort()[0].localeCompare([...b].sort()[0]),
  );
  const colorOf = new Map<string, string>();
  ordered.forEach((ids, i) => {
    const color = clusterColor(i);
    for (const id of ids) colorOf.set(id, color);
  });
  for (const e of kept) {
    const color = colorOf.get(e.source);
    if (color) colorOf.set(e.id, color);
  }

  let reports = 0;
  let actors = 0;
  for (const n of graph.nodes) {
    if (!nodeIds.has(n.id)) continue;
    if (n.type === "adversary") actors += 1;
    else reports += 1;
  }

  return {
    nodeIds,
    edgeIds,
    colorOf,
    clusters: ordered.length,
    reports,
    actors,
    links,
  };
}
