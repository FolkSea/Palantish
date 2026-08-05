"use server";

import { createClient } from "@/lib/supabase/server";
import { nexusForCountry } from "@/lib/actor-classify";
import { fetchAllPages, fetchAllByIds } from "@/lib/supabase/paging";
import { techniqueInfo } from "@/lib/mitre/techniques";
import { itemNode, adversaryNodeFor, edge, mergeGraph } from "@/lib/graph/build";
import { collapseToPairs, type EntityLink } from "@/lib/graph/network";
import type {
  GraphData,
  GraphEdge,
  GraphNode,
  GraphResult,
} from "@/lib/graph/types";

const ITEM_COLS =
  "id, kind, title, raw_hash, url, description, source_name, published_at, crowdstrike_adversary, adversary_label, country, motivation";

type ItemRow = {
  id: string;
  kind: string;
  title: string;
  raw_hash: string;
  url: string | null;
  description: string | null;
  source_name: string | null;
  published_at: string | null;
  crowdstrike_adversary: string | null;
  adversary_label: string | null;
  country: string | null;
  motivation: string | null;
};

export type NetworkResult = GraphResult & { droppedEntities?: number };

/** One indicator two reports have in common. */
export type SharedEntity = {
  value: string;
  /** The raw iocs.ioc_type: ip | domain | uri | file_hash | cve | mitre. */
  iocType: string;
  /** For a technique, its ATT&CK name when known. */
  name?: string;
};

export type SharedEntitiesResult =
  | { ok: true; entities: SharedEntity[]; truncated: boolean }
  | { ok: false; error: string };

// A pair can share hundreds of indicators (the strongest here shares 544).
// Listing every one would be a wall of hashes nobody reads, so the panel shows
// this many and says how many more there are.
const SHARED_LIST_CAP = 200;

/**
 * The indicators two reports have in common.
 *
 * Fetched when a connection is clicked rather than shipped with the graph: the
 * edges already number in the hundreds, and attaching each one's indicator list
 * would multiply the page payload for data almost all of which is never looked
 * at.
 */
export async function sharedEntitiesAction(
  itemIdA: string,
  itemIdB: string,
): Promise<SharedEntitiesResult> {
  if (!itemIdA || !itemIdB) return { ok: false, error: "Missing report." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authorized." };

  const idsFor = async (itemId: string) => {
    const rows = await fetchAllPages<{ ioc_id: string }>((from, to) =>
      supabase
        .from("intel_item_iocs")
        .select("ioc_id")
        .eq("intel_item_id", itemId)
        .order("ioc_id")
        .range(from, to),
    );
    return new Set(rows.map((r) => r.ioc_id));
  };

  const [a, b] = await Promise.all([idsFor(itemIdA), idsFor(itemIdB)]);
  const shared = [...a].filter((id) => b.has(id));
  if (shared.length === 0) return { ok: true, entities: [], truncated: false };

  const rows = await fetchAllByIds<{ id: string; value: string; ioc_type: string }>(
    shared,
    (chunk, from, to) =>
      supabase
        .from("iocs")
        .select("id, value, ioc_type")
        .in("id", chunk)
        .order("id")
        .range(from, to),
  );

  // Group by kind in a fixed order, then alphabetically, so the same pair always
  // reads the same way and the interesting kinds come first.
  const ORDER = ["cve", "mitre", "ip", "domain", "uri", "file_hash"];
  rows.sort((x, y) => {
    const d = ORDER.indexOf(x.ioc_type) - ORDER.indexOf(y.ioc_type);
    return d !== 0 ? d : x.value.localeCompare(y.value);
  });

  const entities: SharedEntity[] = rows.slice(0, SHARED_LIST_CAP).map((r) => ({
    value: r.value,
    iocType: r.ioc_type,
    name:
      r.ioc_type === "mitre"
        ? (techniqueInfo(r.value)?.name ?? undefined)
        : undefined,
  }));
  return { ok: true, entities, truncated: rows.length > SHARED_LIST_CAP };
}

/**
 * The report network: which reports are connected to which, and by how much.
 *
 * Only reports and actors are drawn. Every indicator two reports share - IOCs,
 * CVEs, techniques - is collapsed into one connection whose strength is the
 * number of them, because the individual indicators are what the seeded graph
 * is for; here they are evidence for an edge, not things to look at.
 *
 * A report with no shared indicator is omitted, whatever else is known about
 * it. Roughly half the corpus is unconnected, and drawing those as a field of
 * loose dots buries the structure this view exists to show.
 */
export async function reportNetworkAction(): Promise<NetworkResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authorized." };
  const db = supabase;

  const { data: hiddenRows } = await db.from("hidden_items").select("raw_hash");
  const hidden = new Set((hiddenRows ?? []).map((r) => r.raw_hash));

  // Paged: both tables run past PostgREST's 1000-row cap, which truncates
  // silently rather than erroring.
  const items = (
    await fetchAllPages<ItemRow>(
      (from, to) =>
        db.from("intel_items").select(ITEM_COLS).order("id").range(from, to) as unknown as
          PromiseLike<{ data: ItemRow[] | null }>,
    )
  ).filter((i) => !hidden.has(i.raw_hash));
  const itemById = new Map(items.map((i) => [i.id, i]));

  const rawLinks = await fetchAllPages<{ intel_item_id: string; ioc_id: string }>(
    (from, to) =>
      db
        .from("intel_item_iocs")
        .select("intel_item_id, ioc_id")
        // Both columns, because range paging over a non-unique sort is not
        // stable: ioc_id alone repeats across thousands of rows, so rows either
        // side of a page boundary can reorder between requests and go missing.
        // Together they are the primary key, so the order is total.
        .order("ioc_id")
        .order("intel_item_id")
        .range(from, to),
  );
  const links: EntityLink[] = rawLinks
    .filter((l) => itemById.has(l.intel_item_id))
    .map((l) => ({ itemId: l.intel_item_id, entityId: l.ioc_id }));

  const { edges: pairEdges, linked, dropped } = collapseToPairs(links);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [...pairEdges];
  // Shared indicators are the whole subject of this view, so they decide who
  // appears. A report with none of its own is not drawn even when an actor
  // would have vouched for it: an attribution in common is a fact about the
  // reporting, not evidence that two campaigns are the same one.
  const keep = new Set(linked);

  // Actors. A report attached to an actor that no other report names adds a
  // dangling pair rather than a connection, so an actor has to cover at least
  // two of the reports on the canvas to appear - the same "must connect
  // something" rule the reports themselves are held to.
  const itemsByActor = new Map<string, ItemRow[]>();
  for (const item of items) {
    if (!keep.has(item.id)) continue;
    const name = item.crowdstrike_adversary ?? item.adversary_label;
    if (!name) continue;
    const list = itemsByActor.get(name);
    if (list) list.push(item);
    else itemsByActor.set(name, [item]);
  }

  for (const [name, actorItems] of itemsByActor) {
    if (actorItems.length < 2) continue;
    const first = actorItems[0];
    const nexus = first.country
      ? nexusForCountry(first.country)
      : first.motivation === "ecrime" || first.motivation === "hacktivism"
        ? "other"
        : null;
    // adversaryNodeFor rejects UNID and bare family names (BEAR, SPIDER), which
    // would otherwise pull dozens of unrelated reports onto one hub.
    const adv = adversaryNodeFor(name, nexus);
    if (!adv) continue;
    nodes.push(adv);
    for (const item of actorItems) edges.push(edge(`item:${item.id}`, adv.id));
  }

  for (const id of keep) {
    const item = itemById.get(id);
    if (item) nodes.push(itemNode(item));
  }

  const graph: GraphData = mergeGraph({ nodes, edges });
  return { ok: true, graph, droppedEntities: dropped.length };
}
