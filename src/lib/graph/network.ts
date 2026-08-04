// The report network: reports and actors only, with the indicators between two
// reports collapsed into one weighted connection.
//
// Pure, so the shape of the graph is testable without a database - the queries
// live in the server action that calls this.

import { edge } from "./build";
import type { GraphEdge } from "./types";

/** One report/entity link, as stored in intel_item_iocs. */
export type EntityLink = { itemId: string; entityId: string };

export type NetworkPairs = {
  /** Report-to-report edges, weighted by how many entities the pair shares. */
  edges: GraphEdge[];
  /** Reports with at least one such edge. */
  linked: Set<string>;
};

/**
 * Collapse shared indicators into one edge per pair of reports.
 *
 * An entity referenced by n reports contributes every one of its n*(n-1)/2
 * pairs, so a single popular indicator can dominate the graph. `maxFanout`
 * drops entities above a fan-out - one CVE in 200 advisories says only "these
 * are all advisories", while costing ~20,000 edges - and returns them so the
 * caller can say what was excluded rather than silently thinning the graph.
 */
export function collapseToPairs(
  links: EntityLink[],
  maxFanout = 25,
): NetworkPairs & { dropped: string[] } {
  const itemsByEntity = new Map<string, Set<string>>();
  for (const l of links) {
    const set = itemsByEntity.get(l.entityId);
    if (set) set.add(l.itemId);
    else itemsByEntity.set(l.entityId, new Set([l.itemId]));
  }

  const dropped: string[] = [];
  // pair key -> how many entities that pair shares
  const weights = new Map<string, number>();
  for (const [entityId, items] of itemsByEntity) {
    if (items.size < 2) continue; // a pendant links nothing
    if (items.size > maxFanout) {
      dropped.push(entityId);
      continue;
    }
    const ids = [...items].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}|${ids[j]}`;
        weights.set(key, (weights.get(key) ?? 0) + 1);
      }
    }
  }

  const edges: GraphEdge[] = [];
  const linked = new Set<string>();
  for (const [key, weight] of weights) {
    const [a, b] = key.split("|");
    edges.push({ ...edge(`item:${a}`, `item:${b}`), weight });
    linked.add(a);
    linked.add(b);
  }
  return { edges, linked, dropped };
}

/**
 * Stroke width for a connection of the given strength, against the strongest in
 * the graph. Scaled by square root: strengths span orders of magnitude (two
 * reports on the same campaign share hundreds of indicators, most pairs share
 * one), and a linear scale would render everything except the top pair as a
 * hairline.
 */
export function edgeWidth(weight: number, max: number): number {
  const MIN = 1;
  const MAX = 8;
  if (max <= 1) return MIN;
  const t = Math.sqrt(Math.max(1, weight) - 1) / Math.sqrt(max - 1);
  return MIN + t * (MAX - MIN);
}
