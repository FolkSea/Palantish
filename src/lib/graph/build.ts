// Pure graph builders: rows -> typed nodes/edges, plus dedupe/merge helpers.
// No server or DB imports, so this is unit-tested directly.
import { techniqueInfo } from "@/lib/mitre/techniques";
import { isSpecificAdversary } from "@/lib/badges";
import type {
  GraphNode,
  GraphEdge,
  GraphData,
  GraphNodeType,
} from "./types";

export const NODE_COLOR: Record<GraphNodeType, string> = {
  item: "#2563eb",
  ioc: "#0d9488",
  cve: "#dc2626",
  ttp: "#7c3aed",
  adversary: "#f59e0b",
};

export function nodeTypeForIoc(iocType: string): GraphNodeType {
  if (iocType === "mitre") return "ttp";
  if (iocType === "cve") return "cve";
  return "ioc";
}

/** Canonical key for a node value (CVEs are upper-cased so cve iocs and
 * intel_items.cve_id collapse to one node). */
function keyFor(type: GraphNodeType, value: string): string {
  return type === "cve" ? value.toUpperCase() : value;
}

export type ItemRow = {
  id: string;
  title: string;
  raw_hash: string;
  url?: string | null;
  description?: string | null;
  source_name?: string | null;
  published_at?: string | null;
};

export function itemNode(row: ItemRow): GraphNode {
  return {
    id: `item:${row.id}`,
    type: "item",
    label: row.title,
    rawHash: row.raw_hash,
    url: row.url ?? null,
    description: row.description ?? null,
    source: row.source_name ?? null,
    date: row.published_at ?? null,
  };
}

/** An IOC / CVE / TTP node from an iocs value + type. */
export function iocNode(value: string, iocType: string): GraphNode {
  const type = nodeTypeForIoc(iocType);
  const key = keyFor(type, value);
  let label = key;
  if (type === "ttp") {
    const info = techniqueInfo(key);
    label = info ? `${key} ${info.name}` : key;
  }
  return {
    id: `${type}:${key}`,
    type,
    label,
    value: key,
    iocSubtype: type === "ioc" ? iocType : undefined,
  };
}

export function cveNode(cveId: string): GraphNode {
  return iocNode(cveId, "cve");
}

/**
 * An adversary node - but only for a *specific* named actor. UNID / family
 * placeholders (UNID PANDA, SPIDER, ...) would collapse many unrelated reports
 * onto one hub, so they are excluded (null).
 */
export function adversaryNodeFor(
  name: string | null | undefined,
  nexus?: string | null,
): GraphNode | null {
  // Exclude both bare family tokens (isSpecificAdversary) and the "UNID <animal>"
  // label form, so unattributed reports never collapse onto one hub node.
  if (!name || /^unid\b/i.test(name.trim()) || !isSpecificAdversary(name))
    return null;
  return { id: `adv:${name}`, type: "adversary", label: name, nexus: nexus ?? null };
}

/** An undirected edge, keyed by its sorted endpoints so it dedupes regardless
 * of which side it was built from. */
export function edge(a: string, b: string): GraphEdge {
  const [s, t] = a <= b ? [a, b] : [b, a];
  return { id: `${s}--${t}`, source: a, target: b };
}

/** Split a node id back into its type + key (values may contain ":", so only
 * the first ":" is the delimiter). */
export function parseNodeId(id: string): { type: GraphNodeType; key: string } {
  const i = id.indexOf(":");
  return { type: id.slice(0, i) as GraphNodeType, key: id.slice(i + 1) };
}

export function mergeGraph(...parts: GraphData[]): GraphData {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  for (const p of parts) {
    for (const n of p.nodes) if (!nodes.has(n.id)) nodes.set(n.id, n);
    for (const e of p.edges) if (!edges.has(e.id)) edges.set(e.id, e);
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
