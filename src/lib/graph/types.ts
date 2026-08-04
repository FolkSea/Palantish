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

/** IOC node subtypes, as stored in iocs.ioc_type. CVEs and ATT&CK techniques
 * are their own node types, so they are not listed here. */
export const IOC_SUBTYPES = ["ip", "domain", "uri", "file_hash"] as const;
export type IocSubtype = (typeof IOC_SUBTYPES)[number];

export const IOC_SUBTYPE_LABEL: Record<IocSubtype, string> = {
  ip: "IP addresses",
  domain: "Domains",
  uri: "URLs",
  file_hash: "File hashes",
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

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  /**
   * How many entities the two endpoints share, for edges that collapse several
   * shared indicators into one connection (the report network). Undefined on a
   * plain edge, which represents exactly one relationship.
   */
  weight?: number;
};

export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };

export type GraphResult =
  | { ok: true; graph: GraphData; seedId?: string }
  | { ok: false; error: string };
