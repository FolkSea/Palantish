"use server";

import { getAuthenticatedClient } from "@/lib/auth";
import { loadLabelsFor } from "@/lib/report-labels";
import { fetchAllByIds } from "@/lib/supabase/paging";
import {
  parseIocQuery,
  type IocSearchType,
  type IocTerm,
} from "@/lib/ioc-search";
import type { SearchResultRow } from "@/app/actions";

/** Reports sharing one pasted indicator. */
export type IocGroup = {
  value: string;
  type: IocSearchType;
  reports: SearchResultRow[];
  /** True when the indicator has more reports than are listed. */
  truncated: boolean;
};

export type IocSearchResults = {
  groups: IocGroup[];
  /** Indicators found in the text beyond what one search will take. */
  overflow: number;
  /** Set when the text contained nothing that looks like an indicator. */
  error?: string;
};

// Per indicator, matching the dashboard search. An indicator in more reports
// than this is shared infrastructure or a false positive, and either way the
// first fifty say so.
const PER_IOC_LIMIT = 50;

const ITEM_COLS =
  "id, title, url, description, source_name, published_at, country, " +
  "confidence, adversary_label, crowdstrike_adversary, raw_hash";

type ItemRow = Omit<SearchResultRow, "labels">;

/**
 * Find every report that carries any of the indicators in a block of text.
 *
 * Grouped by indicator rather than merged into one list: the question being
 * asked is "where has this been seen", and an answer that pools twenty
 * indicators into a single list cannot be read back against the values that
 * produced it. An indicator nobody has reported is still a group - knowing that
 * a value appears nowhere is the point of asking.
 *
 * Runs as the signed-in user, so row-level security applies, and the reader's
 * own hidden reports are dropped exactly as they are everywhere else.
 */
export async function searchIocs(text: string): Promise<IocSearchResults> {
  const auth = await getAuthenticatedClient();
  if (!auth) return { groups: [], overflow: 0, error: "Not authorized." };
  const db = auth.supabase;

  const { terms, overflow } = parseIocQuery(text);
  if (terms.length === 0) {
    return {
      groups: [],
      overflow: 0,
      error:
        "No IP addresses, domains or file hashes found in that text. " +
        "Fanged or defanged is fine; CVEs and ATT&CK techniques are not searched here.",
    };
  }

  // The stored indicators for the pasted values. Batched, because a paste can
  // carry more values than one `in (...)` should hold.
  const iocs = await fetchAllByIds<{ id: string; value: string; ioc_type: string }>(
    terms.map((t) => t.value),
    (chunk, from, to) =>
      db.from("iocs").select("id, value, ioc_type").in("value", chunk).range(from, to),
  );
  const iocById = new Map(iocs.map((i) => [i.id, i]));

  const links = await fetchAllByIds<{ intel_item_id: string; ioc_id: string }>(
    iocs.map((i) => i.id),
    (chunk, from, to) =>
      db
        .from("intel_item_iocs")
        .select("intel_item_id, ioc_id")
        .in("ioc_id", chunk)
        .range(from, to),
  );

  const itemIds = [...new Set(links.map((l) => l.intel_item_id))];
  const [items, hidden] = await Promise.all([
    fetchAllByIds<ItemRow>(itemIds, (chunk, from, to) =>
      db
        .from("intel_items")
        .select(ITEM_COLS)
        .in("id", chunk)
        // Ordered so paging is stable; the sort that matters is applied below.
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: ItemRow[] | null }>,
    ),
    db.from("hidden_items").select("raw_hash"),
  ]);
  const hiddenHashes = new Set(
    (hidden.data ?? []).map((h) => h.raw_hash as string),
  );
  const itemById = new Map(
    items.filter((i) => !hiddenHashes.has(i.raw_hash)).map((i) => [i.id, i]),
  );

  // Which reports each pasted value appears in. Keyed by the stored value, so
  // the lookup below is by what the database holds rather than by what was
  // typed - the two differ whenever the typed form was defanged.
  const reportsByValue = new Map<string, ItemRow[]>();
  for (const link of links) {
    const ioc = iocById.get(link.ioc_id);
    const item = itemById.get(link.intel_item_id);
    if (!ioc || !item) continue;
    const key = ioc.value.toLowerCase();
    const list = reportsByValue.get(key);
    if (list) list.push(item);
    else reportsByValue.set(key, [item]);
  }

  // Labels only for what is actually listed - a handful of rows rather than
  // every report the indicators touch.
  const shown = new Set<string>();
  const capped = new Map<string, { rows: ItemRow[]; truncated: boolean }>();
  for (const term of terms) {
    const all = (reportsByValue.get(term.value.toLowerCase()) ?? []).sort(
      byNewest,
    );
    const rows = all.slice(0, PER_IOC_LIMIT);
    capped.set(term.value, { rows, truncated: all.length > rows.length });
    for (const r of rows) shown.add(r.id);
  }
  const labels = await loadLabelsFor(db, [...shown]);

  const groups: IocGroup[] = terms.map((term: IocTerm) => {
    const found = capped.get(term.value) ?? { rows: [], truncated: false };
    return {
      value: term.value,
      type: term.type,
      truncated: found.truncated,
      reports: found.rows.map((r) => ({ ...r, labels: labels.get(r.id) ?? [] })),
    };
  });

  return { groups, overflow };
}

/** Newest first, with a stable tiebreak so a redraw cannot reorder equals. */
function byNewest(a: ItemRow, b: ItemRow): number {
  const at = a.published_at ?? "";
  const bt = b.published_at ?? "";
  return at === bt ? a.id.localeCompare(b.id) : at < bt ? 1 : -1;
}
