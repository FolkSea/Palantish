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
// are chunked - concurrently, because a corpus-sized search is many chunks and
// running them in sequence is that many round-trips the user waits through.
const BATCH_SIZE = 200;

// PostgREST caps every response (`max_rows`, 1000 by default) and truncates
// silently rather than erroring, so a request that asks for more just gets less.
// One report can carry hundreds of indicators, so a batch runs well past the cap
// and every query below has to page until a short page says it is done.
const PAGE_SIZE = 1000;

/** Page one request to exhaustion, past the server's per-response row cap. */
async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data } = await page(from, from + PAGE_SIZE - 1);
    const got = data ?? [];
    rows.push(...got);
    if (got.length < PAGE_SIZE) return rows;
  }
}

/** Chunk ids to keep the URI short, then page each chunk to exhaustion. */
async function inBatches<T>(
  ids: string[],
  page: (chunk: string[], from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    chunks.push(ids.slice(i, i + BATCH_SIZE));
  }
  const perChunk = await Promise.all(
    chunks.map((chunk) => fetchAllPages<T>((from, to) => page(chunk, from, to))),
  );
  return perChunk.flat();
}

type LabelRow = { intel_item_id: string; labels: { name: string } | null };

async function loadLabels(db: Db, ids: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const rows = await inBatches<LabelRow>(ids, (chunk, from, to) =>
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
  return map;
}

type IocsByItem = Map<string, { type: string; value: string }[]>;
type IocRow = {
  intel_item_id: string;
  iocs: { ioc_type: string; value: string } | null;
};

async function loadIocs(db: Db, ids: string[]): Promise<IocsByItem> {
  const map: IocsByItem = new Map();
  const rows = await inBatches<IocRow>(ids, (chunk, from, to) =>
    db
      .from("intel_item_iocs")
      .select("intel_item_id, iocs(ioc_type, value)")
      .in("intel_item_id", chunk)
      .order("intel_item_id")
      .order("ioc_id")
      .range(from, to),
  );
  for (const row of rows) {
    const ioc = row.iocs;
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

  // One row past the limit, so "there is more than we searched" is knowable.
  // Both queries page: asking for more rows than the server's cap returns
  // silently returns fewer, which would quietly shrink the corpus instead.
  const [all, hiddenRows] = await Promise.all([
    fetchAllPages<CorpusRow>((from, to) =>
      db
        .from("intel_items")
        .select(ITEM_COLS)
        .order("published_at", { ascending: false, nullsFirst: false })
        // Secondary key: published_at alone is not unique, and paging over a
        // non-deterministic order can repeat or skip rows between pages.
        .order("id")
        .range(from, Math.min(to, SEARCH_CORPUS_LIMIT)) as unknown as PromiseLike<{
        data: CorpusRow[] | null;
      }>,
    ),
    fetchAllPages<{ raw_hash: string }>((from, to) =>
      db.from("hidden_items").select("raw_hash").order("raw_hash").range(from, to),
    ),
  ]);

  const truncated = all.length > SEARCH_CORPUS_LIMIT;
  const hidden = new Set(hiddenRows.map((r) => r.raw_hash));
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
