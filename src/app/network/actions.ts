"use server";

import { createClient } from "@/lib/supabase/server";
import { nexusForCountry } from "@/lib/actor-classify";
import { fetchAllPages } from "@/lib/supabase/paging";
import { itemNode, adversaryNodeFor, edge, mergeGraph } from "@/lib/graph/build";
import { collapseToPairs, type EntityLink } from "@/lib/graph/network";
import type {
  GraphData,
  GraphEdge,
  GraphNode,
  GraphResult,
} from "@/lib/graph/types";

const ITEM_COLS =
  "id, title, raw_hash, url, description, source_name, published_at, crowdstrike_adversary, adversary_label, country, motivation";

type ItemRow = {
  id: string;
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

/**
 * The report network: which reports are connected to which, and by how much.
 *
 * Only reports and actors are drawn. Every indicator two reports share - IOCs,
 * CVEs, techniques - is collapsed into one connection whose strength is the
 * number of them, because the individual indicators are what the seeded graph
 * is for; here they are evidence for an edge, not things to look at.
 *
 * Reports connected to nothing are omitted. Roughly half the corpus is
 * unconnected, and drawing those as a field of loose dots buries the structure
 * this view exists to show.
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

  // Actors. A report attached to an actor that no other report names adds a
  // dangling pair rather than a connection, so an actor has to cover at least
  // two reports to appear - the same "must connect something" rule the reports
  // themselves are held to.
  const itemsByActor = new Map<string, ItemRow[]>();
  for (const item of items) {
    const name = item.crowdstrike_adversary ?? item.adversary_label;
    if (!name) continue;
    const list = itemsByActor.get(name);
    if (list) list.push(item);
    else itemsByActor.set(name, [item]);
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [...pairEdges];
  const keep = new Set(linked);

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
    for (const item of actorItems) {
      keep.add(item.id);
      edges.push(edge(`item:${item.id}`, adv.id));
    }
  }

  for (const id of keep) {
    const item = itemById.get(id);
    if (item) nodes.push(itemNode(item));
  }

  const graph: GraphData = mergeGraph({ nodes, edges });
  return { ok: true, graph, droppedEntities: dropped.length };
}
