"use server";

import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { nexusForCountry } from "@/lib/actor-classify";
import {
  itemNode,
  iocNode,
  cveNode,
  adversaryNodeFor,
  edge,
  mergeGraph,
  parseNodeId,
  type ItemRow,
} from "@/lib/graph/build";
import {
  GRAPH_NODE_TYPES,
  type GraphData,
  type GraphNode,
  type GraphEdge,
  type GraphNodeType,
  type GraphResult,
} from "@/lib/graph/types";

type Db = SupabaseClient<Database>;

// Newest neighbours first, and never more than this per expansion, so a
// high-degree entity (a CVE in hundreds of reports) cannot explode the graph.
const EXPAND_CAP = 40;
const ITEM_COLS =
  "id, title, raw_hash, url, description, source_name, published_at, cve_id, crowdstrike_adversary, adversary_label, country, motivation";

type ItemFull = ItemRow & {
  cve_id: string | null;
  crowdstrike_adversary: string | null;
  adversary_label: string | null;
  country: string | null;
  motivation: string | null;
};

async function authed(): Promise<Db | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? supabase : null;
}

async function hiddenHashes(db: Db): Promise<Set<string>> {
  const { data } = await db.from("hidden_items").select("raw_hash");
  return new Set((data ?? []).map((r) => r.raw_hash));
}

/** Nexus used to tint an adversary node: the item's country, else "other" for
 * eCrime / hacktivism, else null. */
function advNexus(item: ItemFull): string | null {
  if (item.country) return nexusForCountry(item.country);
  if (item.motivation === "ecrime" || item.motivation === "hacktivism")
    return "other";
  return null;
}

/** The neighbours of one item: its IOC / CVE / TTP entities and its adversary,
 * restricted to the requested target types. Always includes the item node. */
async function itemNeighbours(
  db: Db,
  item: ItemFull,
  include: Set<GraphNodeType>,
): Promise<GraphData> {
  const self = itemNode(item);
  const nodes: GraphNode[] = [self];
  const edges = [];

  // IOCs / CVEs / TTPs linked via the join table.
  const { data: links } = await db
    .from("intel_item_iocs")
    .select("iocs(value, ioc_type)")
    .eq("intel_item_id", item.id)
    .limit(EXPAND_CAP);
  for (const l of (links ?? []) as unknown as {
    iocs: { value: string; ioc_type: string } | null;
  }[]) {
    if (!l.iocs?.value) continue;
    const n = iocNode(l.iocs.value, l.iocs.ioc_type);
    if (!include.has(n.type)) continue;
    nodes.push(n);
    edges.push(edge(self.id, n.id));
  }

  // A CVE named directly on the item (exploit rows) - collapses onto the cve node.
  if (item.cve_id && include.has("cve")) {
    const n = cveNode(item.cve_id);
    nodes.push(n);
    edges.push(edge(self.id, n.id));
  }

  // Attributed adversary (specific actors only).
  if (include.has("adversary")) {
    const adv = adversaryNodeFor(
      item.crowdstrike_adversary ?? item.adversary_label,
      advNexus(item),
    );
    if (adv) {
      nodes.push(adv);
      edges.push(edge(self.id, adv.id));
    }
  }

  return mergeGraph({ nodes, edges });
}

/** The item neighbours of an entity node (IOC / CVE / TTP / adversary): the
 * reports that reference it. Deduped, hidden-filtered, capped. */
async function entityItems(
  db: Db,
  type: GraphNodeType,
  key: string,
  hidden: Set<string>,
): Promise<ItemFull[]> {
  const rows: ItemFull[] = [];
  if (type === "adversary") {
    for (const col of ["crowdstrike_adversary", "adversary_label"] as const) {
      const { data } = await db
        .from("intel_items")
        .select(ITEM_COLS)
        .eq(col, key)
        .order("published_at", { ascending: false })
        .limit(EXPAND_CAP);
      rows.push(...((data ?? []) as unknown as ItemFull[]));
    }
  } else {
    // Resolve the ioc row(s) by value, then their linked items.
    const { data: iocRows } = await db
      .from("iocs")
      .select("id")
      .eq("value", key);
    const iocIds = (iocRows ?? []).map((r) => r.id);
    if (iocIds.length) {
      const { data } = await db
        .from("intel_item_iocs")
        .select(`intel_items(${ITEM_COLS})`)
        .in("ioc_id", iocIds)
        .limit(EXPAND_CAP);
      for (const l of (data ?? []) as unknown as { intel_items: ItemFull | null }[])
        if (l.intel_items) rows.push(l.intel_items);
    }
    if (type === "cve") {
      const { data } = await db
        .from("intel_items")
        .select(ITEM_COLS)
        .eq("cve_id", key)
        .order("published_at", { ascending: false })
        .limit(EXPAND_CAP);
      rows.push(...((data ?? []) as unknown as ItemFull[]));
    }
  }

  // Dedupe by id, drop hidden, cap.
  const seen = new Set<string>();
  const out: ItemFull[] = [];
  for (const r of rows) {
    if (seen.has(r.id) || hidden.has(r.raw_hash)) continue;
    seen.add(r.id);
    out.push(r);
    if (out.length >= EXPAND_CAP) break;
  }
  return out;
}

// A second step out from the seed: the reports that share the seed's depth-1
// entities. Batched (a handful of queries, not one per entity) and capped so a
// high-degree entity (a popular CVE, a prolific actor) cannot explode the seed.
const SEED_DEPTH2_CAP = 60;

async function depth2Items(
  db: Db,
  entityNodes: GraphNode[],
  hidden: Set<string>,
  seedItemId: string,
): Promise<GraphData> {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  const addItem = (row: ItemFull, sourceNodeId: string) => {
    if (row.id === seedItemId || hidden.has(row.raw_hash)) return;
    const n = itemNode(row);
    if (!seen.has(n.id)) {
      if (seen.size >= SEED_DEPTH2_CAP) return;
      seen.add(n.id);
      nodes.push(n);
    }
    edges.push(edge(sourceNodeId, n.id));
  };

  // IOC / CVE / TTP entities -> the reports linked to those iocs.
  const valueToNode = new Map<string, string>();
  for (const n of entityNodes)
    if (n.type !== "adversary" && n.value) valueToNode.set(n.value, n.id);
  const values = [...valueToNode.keys()];
  if (values.length) {
    const { data: iocRows } = await db
      .from("iocs")
      .select("id, value")
      .in("value", values);
    const iocIdToValue = new Map<string, string>(
      (iocRows ?? []).map((r) => [r.id, r.value]),
    );
    const iocIds = (iocRows ?? []).map((r) => r.id);
    if (iocIds.length) {
      const { data } = await db
        .from("intel_item_iocs")
        .select(`ioc_id, intel_items(${ITEM_COLS})`)
        .in("ioc_id", iocIds)
        .limit(500);
      for (const row of (data ?? []) as unknown as {
        ioc_id: string;
        intel_items: ItemFull | null;
      }[]) {
        if (!row.intel_items) continue;
        const v = iocIdToValue.get(row.ioc_id);
        const src = v ? valueToNode.get(v) : undefined;
        if (src) addItem(row.intel_items, src);
      }
    }
  }

  // CVE entities also match intel_items.cve_id directly.
  const cveValues = entityNodes
    .filter((n) => n.type === "cve" && n.value)
    .map((n) => n.value as string);
  if (cveValues.length) {
    const { data } = await db
      .from("intel_items")
      .select(ITEM_COLS)
      .in("cve_id", cveValues)
      .limit(300);
    for (const it of (data ?? []) as unknown as ItemFull[])
      if (it.cve_id) addItem(it, `cve:${it.cve_id.toUpperCase()}`);
  }

  // Adversary entities -> the reports attributed to them.
  const advNames = entityNodes
    .filter((n) => n.type === "adversary")
    .map((n) => parseNodeId(n.id).key);
  if (advNames.length) {
    for (const col of ["crowdstrike_adversary", "adversary_label"] as const) {
      const { data } = await db
        .from("intel_items")
        .select(ITEM_COLS)
        .in(col, advNames)
        .order("published_at", { ascending: false })
        .limit(300);
      for (const it of (data ?? []) as unknown as ItemFull[]) {
        const name = it[col];
        if (name) addItem(it, `adv:${name}`);
      }
    }
  }

  return { nodes, edges };
}

// Rows fetched to count a node's neighbours are cheap (single column), but a
// hub entity can link thousands of reports - cap the scan so counting stays fast.
const DEGREE_SCAN_CAP = 5000;

/**
 * Set node.degree = the count of *distinct, non-hidden neighbour nodes* the node
 * could ever expand into - deliberately the same set expansion produces, so a
 * fully-opened node's rendered edges reach its degree and its halo clears. We
 * count distinct nodes (deduping a CVE reachable via both intel_item_iocs and
 * cve_id, and duplicate ioc rows sharing a value) and drop hidden reports.
 * Batched by type: a handful of scans, deduped into sets in memory.
 */
async function withDegrees(
  db: Db,
  nodes: GraphNode[],
  hidden: Set<string>,
): Promise<void> {
  // Entity nodes (ioc/cve/ttp): neighbours are the reports that reference them.
  const entityNodes = nodes.filter(
    (n) => n.value && (n.type === "ioc" || n.type === "cve" || n.type === "ttp"),
  );
  if (entityNodes.length) {
    const values = [...new Set(entityNodes.map((n) => n.value as string))];
    const { data: iocRows } = await db
      .from("iocs")
      .select("id, value")
      .in("value", values);
    const idToValue = new Map<string, string>(
      (iocRows ?? []).map((r) => [r.id, r.value]),
    );
    const iocIds = (iocRows ?? []).map((r) => r.id);
    // value -> set of distinct non-hidden item ids referencing it.
    const itemsByValue = new Map<string, Set<string>>();
    const add = (value: string | undefined, id: string, rawHash: string) => {
      if (!value || hidden.has(rawHash)) return;
      (itemsByValue.get(value) ?? itemsByValue.set(value, new Set()).get(value)!).add(id);
    };
    if (iocIds.length) {
      const { data } = await db
        .from("intel_item_iocs")
        .select("ioc_id, intel_items(id, raw_hash)")
        .in("ioc_id", iocIds)
        .limit(DEGREE_SCAN_CAP);
      for (const r of (data ?? []) as unknown as {
        ioc_id: string;
        intel_items: { id: string; raw_hash: string } | null;
      }[]) {
        if (r.intel_items)
          add(idToValue.get(r.ioc_id), r.intel_items.id, r.intel_items.raw_hash);
      }
    }
    // CVEs also match intel_items.cve_id directly (same node, so dedupe by id).
    const cveValues = entityNodes
      .filter((n) => n.type === "cve")
      .map((n) => n.value as string);
    if (cveValues.length) {
      const { data } = await db
        .from("intel_items")
        .select("id, raw_hash, cve_id")
        .in("cve_id", cveValues)
        .limit(DEGREE_SCAN_CAP);
      for (const r of (data ?? []) as {
        id: string;
        raw_hash: string;
        cve_id: string | null;
      }[])
        add(r.cve_id?.toUpperCase(), r.id, r.raw_hash);
    }
    for (const n of entityNodes)
      n.degree = itemsByValue.get(n.value as string)?.size ?? 0;
  }

  // Adversary nodes: neighbours are the reports attributed to them.
  const advNodes = nodes.filter((n) => n.type === "adversary");
  if (advNodes.length) {
    const names = [...new Set(advNodes.map((n) => parseNodeId(n.id).key))];
    const itemsByName = new Map<string, Set<string>>();
    for (const col of ["crowdstrike_adversary", "adversary_label"] as const) {
      const { data } = await db
        .from("intel_items")
        .select(`id, raw_hash, ${col}`)
        .in(col, names)
        .limit(DEGREE_SCAN_CAP);
      for (const r of (data ?? []) as Record<string, string | null>[]) {
        const nm = r[col];
        if (nm && r.raw_hash && !hidden.has(r.raw_hash))
          (itemsByName.get(nm) ?? itemsByName.set(nm, new Set()).get(nm)!).add(
            r.id as string,
          );
      }
    }
    for (const n of advNodes)
      n.degree = itemsByName.get(parseNodeId(n.id).key)?.size ?? 0;
  }

  // Item nodes: neighbours are their distinct linked IOC/CVE/TTP entity nodes.
  // (The always-rendered cve_id/adversary edges are omitted here - they never
  // cause a false "has more" because rendered edges then meet or exceed degree.)
  const itemNodes = nodes.filter((n) => n.type === "item");
  if (itemNodes.length) {
    const ids = itemNodes.map((n) => parseNodeId(n.id).key);
    const entitiesByItem = new Map<string, Set<string>>();
    const { data } = await db
      .from("intel_item_iocs")
      .select("intel_item_id, iocs(value, ioc_type)")
      .in("intel_item_id", ids)
      .limit(DEGREE_SCAN_CAP * 2);
    for (const r of (data ?? []) as unknown as {
      intel_item_id: string;
      iocs: { value: string; ioc_type: string } | null;
    }[]) {
      if (!r.iocs?.value) continue;
      const nodeId = iocNode(r.iocs.value, r.iocs.ioc_type).id;
      (
        entitiesByItem.get(r.intel_item_id) ??
        entitiesByItem.set(r.intel_item_id, new Set()).get(r.intel_item_id)!
      ).add(nodeId);
    }
    for (const n of itemNodes)
      n.degree = entitiesByItem.get(parseNodeId(n.id).key)?.size ?? 0;
  }
}

/**
 * Seed the graph on a report, two steps out: the item, its depth-1 entities
 * (IOC/CVE/TTP/adversary), and the reports that share those entities.
 */
export async function seedGraphAction(rawHash: string): Promise<GraphResult> {
  if (!rawHash) return { ok: false, error: "Missing report." };
  const db = await authed();
  if (!db) return { ok: false, error: "Not authorized." };

  const { data: itemData } = await db
    .from("intel_items")
    .select(ITEM_COLS)
    .eq("raw_hash", rawHash)
    .maybeSingle();
  if (!itemData) return { ok: false, error: "Report not found." };
  const item = itemData as unknown as ItemFull;

  const g1 = await itemNeighbours(db, item, new Set(GRAPH_NODE_TYPES));
  const hidden = await hiddenHashes(db);
  const entityNodes = g1.nodes.filter((n) => n.type !== "item");
  const g2 = await depth2Items(db, entityNodes, hidden, item.id);

  const graph = mergeGraph(g1, g2);
  await withDegrees(db, graph.nodes, hidden);
  return {
    ok: true,
    graph,
    seedId: `item:${item.id}`,
  };
}

/**
 * Expand one node by a depth of 1, following only edges to the chosen node
 * types. Item nodes yield their entities; entity nodes yield their reports.
 */
export async function expandNodeAction(
  nodeId: string,
  includeTypes: GraphNodeType[],
): Promise<GraphResult> {
  const db = await authed();
  if (!db) return { ok: false, error: "Not authorized." };
  const include = new Set<GraphNodeType>(
    includeTypes.length ? includeTypes : GRAPH_NODE_TYPES,
  );
  const { type, key } = parseNodeId(nodeId);
  const hidden = await hiddenHashes(db);

  if (type === "item") {
    const { data: item } = await db
      .from("intel_items")
      .select(ITEM_COLS)
      .eq("id", key)
      .maybeSingle();
    if (!item) return { ok: true, graph: { nodes: [], edges: [] } };
    const graph = await itemNeighbours(db, item as unknown as ItemFull, include);
    await withDegrees(db, graph.nodes, hidden);
    return { ok: true, graph };
  }

  // Entity node: its only neighbours are items.
  if (!include.has("item")) return { ok: true, graph: { nodes: [], edges: [] } };
  const items = await entityItems(db, type, key, hidden);
  const nodes: GraphNode[] = [];
  const edges = [];
  for (const r of items) {
    const n = itemNode(r);
    nodes.push(n);
    edges.push(edge(nodeId, n.id));
  }
  await withDegrees(db, nodes, hidden);
  return { ok: true, graph: { nodes, edges } };
}
