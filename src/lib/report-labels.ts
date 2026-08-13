import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { fetchAllByIds, fetchAllPages } from "@/lib/supabase/paging";

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

/**
 * The labels on every report published since `cutoff`, in one query.
 *
 * loadLabelsFor needs the report ids, which means waiting for the reports to
 * come back before the labels can even be asked for - a second round trip after
 * the dashboard's other nine have all finished. The window is the same filter
 * the reports themselves use, so the labels can be fetched from it directly and
 * ride along in the same wave.
 *
 * Returns null rather than an empty map if the query fails, so the caller can
 * fall back to the id-based loader instead of silently rendering a dashboard
 * with no label chips on it.
 */
export async function loadLabelsSince(
  db: SupabaseClient<Database>,
  cutoff: string,
): Promise<Map<string, string[]> | null> {
  const map = new Map<string, string[]>();
  let failed = false;
  const rows = await fetchAllPages<LabelRow>(async (from, to) => {
    const res = await db
      .from("intel_item_labels")
      .select("intel_item_id, labels(name), intel_items!inner(published_at)")
      .gte("intel_items.published_at", cutoff)
      .order("intel_item_id")
      .order("label_id")
      .range(from, to);
    if (res.error) failed = true;
    return res as unknown as { data: LabelRow[] | null };
  });
  if (failed) return null;
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
