import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { fetchAllByIds } from "@/lib/supabase/paging";

type LabelRow = { intel_item_id: string; labels: { name: string } | null };

/**
 * The labels on each of the given reports. Every list view shows label chips,
 * so this is the one loader they all use - paged and chunked, because the join
 * runs well past PostgREST's silent row cap on a corpus-sized id set.
 */
export async function loadLabelsFor(
  db: SupabaseClient<Database>,
  ids: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  const rows = await fetchAllByIds<LabelRow>(ids, (chunk, from, to) =>
    db
      .from("intel_item_labels")
      .select("intel_item_id, labels(name)")
      // Ordered so paging is stable; the join table's key is the pair.
      .in("intel_item_id", chunk)
      .order("intel_item_id")
      .order("label_id")
      .range(from, to),
  );
  for (const row of rows) {
    const name = row.labels?.name;
    if (!name) continue;
    const arr = map.get(row.intel_item_id);
    if (arr) arr.push(name);
    else map.set(row.intel_item_id, [name]);
  }
  for (const [id, names] of map) {
    map.set(id, names.sort((a, b) => a.localeCompare(b)));
  }
  return map;
}
