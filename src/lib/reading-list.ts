import "server-only";

import { getAuthenticatedClient } from "@/lib/auth";
import { fetchAllPages } from "@/lib/supabase/paging";
import { loadLabelsFor } from "@/lib/report-labels";
import type { SearchResultRow } from "@/app/actions";

export type ReadingListResult = {
  items: SearchResultRow[];
  /** When each was added, keyed by report id - the list is ordered by it. */
  addedAt: Map<string, string>;
};

const ITEM_COLS =
  "id, title, url, description, source_name, published_at, raw_hash, " +
  "country, confidence, adversary_label, crowdstrike_adversary";

type ItemRow = {
  id: string;
  title: string;
  url: string | null;
  description: string | null;
  source_name: string | null;
  published_at: string | null;
  raw_hash: string;
  country: string | null;
  confidence: string | null;
  adversary_label: string | null;
  crowdstrike_adversary: string | null;
};

/**
 * The signed-in user's reading list, most recently bookmarked first.
 *
 * Ordered by when it was added rather than when it was published: this is a
 * working list, so what you picked up last is what you are most likely still on.
 *
 * RLS-scoped - the bookmarks table only ever exposes a user their own rows.
 */
export async function loadReadingList(): Promise<ReadingListResult> {
  const empty: ReadingListResult = { items: [], addedAt: new Map() };
  const auth = await getAuthenticatedClient();
  if (!auth) return empty;
  const db = auth.supabase;

  const marks = await fetchAllPages<{ intel_item_id: string; created_at: string }>(
    (from, to) =>
      db
        .from("bookmarks")
        .select("intel_item_id, created_at")
        .order("created_at", { ascending: false })
        .order("intel_item_id")
        .range(from, to),
  );
  if (marks.length === 0) return empty;

  const addedAt = new Map(marks.map((m) => [m.intel_item_id, m.created_at]));
  const ids = marks.map((m) => m.intel_item_id);

  const { data } = await db.from("intel_items").select(ITEM_COLS).in("id", ids);
  const rows = (data ?? []) as unknown as ItemRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const labels = await loadLabelsFor(db, ids);

  // Walk the bookmarks, not the reports, so the order is the one the user
  // built. A report deleted since it was bookmarked simply drops out.
  const items = ids
    .map((id) => byId.get(id))
    .filter((r): r is ItemRow => !!r)
    .map(
      (r): SearchResultRow => ({
        id: r.id,
        title: r.title,
        url: r.url,
        description: r.description,
        source_name: r.source_name,
        published_at: r.published_at,
        country: r.country,
        confidence: r.confidence,
        adversary_label: r.adversary_label,
        crowdstrike_adversary: r.crowdstrike_adversary,
        raw_hash: r.raw_hash,
        labels: labels.get(r.id) ?? [],
      }),
    );

  return { items, addedAt };
}
