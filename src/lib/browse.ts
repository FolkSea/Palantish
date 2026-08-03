import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isThreatIntel } from "@/lib/relevance";
import type { LabeledIntelRow } from "@/lib/data";
import type { BrowseFilter } from "@/lib/browse-links";

// Enough to browse a busy label or a prolific source without an unbounded query;
// the page says so when a filter has more than this.
export const BROWSE_LIMIT = 200;

const ITEM_COLS =
  "id, kind, title, description, url, source_name, published_at, country, " +
  "confidence, adversary_label, crowdstrike_adversary, raw_hash, motivation, " +
  "item_type, cve_id, target, exploit_status, created_at";

export type BrowseResult = {
  items: LabeledIntelRow[];
  /** True when the filter matched more reports than were returned. */
  truncated: boolean;
};

type Db = Awaited<ReturnType<typeof createClient>>;

async function idsForLabel(db: Db, name: string): Promise<string[] | null> {
  const { data: labelRows } = await db
    .from("labels")
    .select("id")
    .ilike("name", name);
  const labelIds = (labelRows ?? []).map((r) => r.id);
  if (labelIds.length === 0) return null;
  const { data } = await db
    .from("intel_item_labels")
    .select("intel_item_id")
    .in("label_id", labelIds);
  return [...new Set((data ?? []).map((r) => r.intel_item_id))];
}

async function labelsById(
  db: Db,
  ids: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const unique = [...new Set(ids)];
  // Batched: many UUIDs in one .in() filter would overflow the request URI.
  for (let i = 0; i < unique.length; i += 100) {
    const { data } = await db
      .from("intel_item_labels")
      .select("intel_item_id, labels(name)")
      .in("intel_item_id", unique.slice(i, i + 100));
    for (const row of data ?? []) {
      const name = (row.labels as { name: string } | null)?.name;
      if (!name) continue;
      const arr = map.get(row.intel_item_id);
      if (arr) arr.push(name);
      else map.set(row.intel_item_id, [name]);
    }
  }
  for (const [id, names] of map)
    map.set(id, names.sort((a, b) => a.localeCompare(b)));
  return map;
}

/**
 * Reports matching one browse filter, newest first. RLS-scoped like the rest of
 * the dashboard, and filtered the same way it is: the user's hidden items and
 * non-intelligence posts are excluded so browsing agrees with what the dashboard
 * shows. Returns an empty result for an unknown label / adversary / source.
 */
export async function loadBrowse(filter: BrowseFilter): Promise<BrowseResult> {
  const db = await createClient();

  // Over-fetch by one so "there are more than we showed" is knowable.
  const cap = BROWSE_LIMIT + 1;
  let rows: LabeledIntelRow[] = [];

  if (filter.kind === "label") {
    const ids = await idsForLabel(db, filter.value);
    if (!ids || ids.length === 0) return { items: [], truncated: false };
    const { data } = await db
      .from("intel_items")
      .select(ITEM_COLS)
      .in("id", ids.slice(0, 1000))
      .order("published_at", { ascending: false })
      .limit(cap);
    rows = (data ?? []) as unknown as LabeledIntelRow[];
  } else if (filter.kind === "adversary") {
    // Two equality queries rather than one .or(): the value is user-supplied and
    // PostgREST's or() filter is a comma-separated mini-syntax.
    const seen = new Set<string>();
    const merged: LabeledIntelRow[] = [];
    for (const col of ["crowdstrike_adversary", "adversary_label"] as const) {
      const { data } = await db
        .from("intel_items")
        .select(ITEM_COLS)
        .eq(col, filter.value)
        .order("published_at", { ascending: false })
        .limit(cap);
      for (const r of (data ?? []) as unknown as LabeledIntelRow[]) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        merged.push(r);
      }
    }
    merged.sort((a, b) =>
      (b.published_at ?? "").localeCompare(a.published_at ?? ""),
    );
    rows = merged.slice(0, cap);
  } else {
    const { data } = await db
      .from("intel_items")
      .select(ITEM_COLS)
      .eq("source_name", filter.value)
      .order("published_at", { ascending: false })
      .limit(cap);
    rows = (data ?? []) as unknown as LabeledIntelRow[];
  }

  // Same visibility rules as the dashboard: drop the user's hidden items and
  // anything that does not read as threat intelligence.
  const { data: hiddenRows } = await db.from("hidden_items").select("raw_hash");
  const hidden = new Set((hiddenRows ?? []).map((r) => r.raw_hash));
  const visible = rows.filter(
    (r) => !hidden.has(r.raw_hash) && isThreatIntel(r.title, r.description),
  );

  const truncated = visible.length > BROWSE_LIMIT;
  const items = visible.slice(0, BROWSE_LIMIT);
  const labels = await labelsById(
    db,
    items.map((i) => i.id),
  );
  return {
    items: items.map((i) => ({ ...i, labels: labels.get(i.id) ?? [] })),
    truncated,
  };
}

export type ItemDetail = {
  /** intel_items.id - what the reading list keys a bookmark on. */
  id: string;
  title: string;
  url: string | null;
  description: string | null;
  sourceName: string | null;
  date: string | null;
  adversary: string | null;
  country: string | null;
  confidence: string | null;
  rawHash: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One report for its own page, addressed by raw_hash (what the app's links use)
 * or by the intel_items uuid, so a link built from either identifier resolves.
 * Null when nothing matches, which the route turns into a 404.
 */
export async function loadItem(key: string): Promise<ItemDetail | null> {
  const k = (key ?? "").trim();
  if (!k) return null;
  const db = await createClient();
  const cols =
    "id, title, url, description, source_name, published_at, country, confidence, " +
    "adversary_label, crowdstrike_adversary, raw_hash";

  // raw_hash first: every in-app link uses it, so this is the common path.
  let { data } = await db.from("intel_items").select(cols).eq("raw_hash", k).maybeSingle();
  if (!data && UUID_RE.test(k)) {
    ({ data } = await db.from("intel_items").select(cols).eq("id", k).maybeSingle());
  }
  if (!data) return null;

  const r = data as unknown as {
    id: string;
    title: string;
    url: string | null;
    description: string | null;
    source_name: string | null;
    published_at: string | null;
    country: string | null;
    confidence: string | null;
    adversary_label: string | null;
    crowdstrike_adversary: string | null;
    raw_hash: string | null;
  };
  return {
    id: r.id,
    title: r.title,
    url: r.url,
    description: r.description,
    sourceName: r.source_name,
    date: r.published_at,
    adversary: r.adversary_label ?? r.crowdstrike_adversary,
    country: r.country,
    confidence: r.confidence,
    rawHash: r.raw_hash,
  };
}
