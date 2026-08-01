import "server-only";

import { createClient } from "@/lib/supabase/server";
import { toDoc, type CorpusRow, type SearchDoc } from "@/lib/search/evaluate";
import type { Field, QueryNode } from "@/lib/search/query";
import { fieldsUsed } from "@/lib/search/query";

// The query language evaluates in memory (see evaluate.ts), so the corpus is
// bounded: the most recent reports, which is where analyst searches live. The
// caller says so when a search ran against a truncated corpus.
export const SEARCH_CORPUS_LIMIT = 4000;

const ITEM_COLS =
  "id, kind, title, url, description, source_name, published_at, raw_hash, " +
  "cve_id, target, exploit_status, date_label, adversary_label, crowdstrike_adversary";

export type { CorpusRow };

export type Corpus = {
  rows: CorpusRow[];
  docs: SearchDoc[];
  /** True when more reports exist than the corpus limit allowed us to search. */
  truncated: boolean;
};

type Db = Awaited<ReturnType<typeof createClient>>;

const INDICATOR_FIELDS: Field[] = ["ip", "domain", "url", "hash", "cve", "ioc", "ttp"];

// Many UUIDs in one `.in()` filter would overflow the request URI, so the ids
// are chunked - concurrently, because a corpus-sized search is 20 chunks and
// running them in sequence is 20 round-trips the user waits through.
const BATCH_SIZE = 200;

async function inBatches<T>(
  ids: string[],
  run: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    chunks.push(ids.slice(i, i + BATCH_SIZE));
  }
  return (await Promise.all(chunks.map(run))).flat();
}

async function loadLabels(db: Db, ids: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const rows = await inBatches(ids, async (chunk) => {
    const { data } = await db
      .from("intel_item_labels")
      .select("intel_item_id, labels(name)")
      .in("intel_item_id", chunk);
    return data ?? [];
  });
  for (const row of rows) {
    const name = (row.labels as { name: string } | null)?.name;
    if (!name) continue;
    const arr = map.get(row.intel_item_id);
    if (arr) arr.push(name);
    else map.set(row.intel_item_id, [name]);
  }
  return map;
}

type IocsByItem = Map<string, { type: string; value: string }[]>;

async function loadIocs(db: Db, ids: string[]): Promise<IocsByItem> {
  const map: IocsByItem = new Map();
  const rows = await inBatches(ids, async (chunk) => {
    const { data } = await db
      .from("intel_item_iocs")
      .select("intel_item_id, iocs(ioc_type, value)")
      .in("intel_item_id", chunk);
    return data ?? [];
  });
  for (const row of rows) {
    const ioc = row.iocs as { ioc_type: string; value: string } | null;
    if (!ioc?.value) continue;
    const entry = { type: ioc.ioc_type, value: ioc.value };
    const arr = map.get(row.intel_item_id);
    if (arr) arr.push(entry);
    else map.set(row.intel_item_id, [entry]);
  }
  return map;
}

/**
 * Load the reports a query will be evaluated against, plus only the joined data
 * the query actually needs: most searches never mention a label or an indicator,
 * and those joins are the expensive part.
 *
 * RLS-scoped like the rest of the dashboard, and the user's hidden reports are
 * dropped here so they cannot surface through any field.
 */
export async function loadSearchCorpus(node: QueryNode): Promise<Corpus> {
  const db = await createClient();
  const used = fieldsUsed(node);

  const [itemsRes, hiddenRes] = await Promise.all([
    db
      .from("intel_items")
      .select(ITEM_COLS)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(SEARCH_CORPUS_LIMIT + 1),
    db.from("hidden_items").select("raw_hash"),
  ]);

  const all = (itemsRes.data ?? []) as unknown as CorpusRow[];
  const truncated = all.length > SEARCH_CORPUS_LIMIT;
  const hidden = new Set((hiddenRes.data ?? []).map((r) => r.raw_hash));
  const rows = all.slice(0, SEARCH_CORPUS_LIMIT).filter((r) => !hidden.has(r.raw_hash));
  const ids = rows.map((r) => r.id);

  const wantsLabels = used.has("label");
  const wantsIocs = INDICATOR_FIELDS.some((f) => used.has(f));
  const [labels, iocs] = await Promise.all([
    wantsLabels ? loadLabels(db, ids) : Promise.resolve(new Map<string, string[]>()),
    wantsIocs ? loadIocs(db, ids) : Promise.resolve<IocsByItem>(new Map()),
  ]);

  const docs = rows.map((r) => toDoc(r, labels.get(r.id) ?? [], iocs.get(r.id) ?? []));
  return { rows, docs, truncated };
}
