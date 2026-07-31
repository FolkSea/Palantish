// Node/edge shapes for the link-analysis graph. Kept dependency-free so the
// pure builder (./build) and its tests can import them without server code.

export type GraphNodeType = "item" | "ioc" | "cve" | "ttp" | "adversary";

/** The five vertex types, in a stable order for legends and filters. */
export const GRAPH_NODE_TYPES: GraphNodeType[] = [
  "item",
  "ioc",
  "cve",
  "ttp",
  "adversary",
];

export const GRAPH_TYPE_LABEL: Record<GraphNodeType, string> = {
  item: "Intelligence Item",
  ioc: "IOC",
  cve: "CVE",
  ttp: "TTP (ATT&CK)",
  adversary: "Adversary",
};

export type GraphNode = {
  id: string; // `${type}:${key}` - key is the item id, ioc/cve/ttp value, or actor name
  type: GraphNodeType;
  label: string;
  // Item nodes carry enough to open the report modal without another fetch.
  rawHash?: string | null;
  url?: string | null;
  description?: string | null;
  source?: string | null;
  date?: string | null;
  // IOC/CVE/TTP nodes.
  value?: string;
  iocSubtype?: string; // ioc only: ip | domain | uri | file_hash
  // Adversary nodes - nexus tints the node colour.
  nexus?: string | null;
  // Total connectable neighbours in the DB. The view rings a node when its
  // rendered connections are fewer than this (it has more to expand).
  degree?: number;
};

export type GraphEdge = { id: string; source: string; target: string };

export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };

export type GraphResult =
  | { ok: true; graph: GraphData; seedId?: string }
  | { ok: false; error: string };
