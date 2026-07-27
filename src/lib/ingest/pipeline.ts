import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { pullAllFeeds, type FeedSource } from "./feeds";
import { selectNewCandidates } from "./dedup";
import { selectEnricher } from "./enrich/llm";
import { selectSearchProvider } from "./search";
import { buildGroupsFromAdversaries } from "./adversaries";
import type { EnrichedItem } from "./types";
import type { Database } from "@/lib/supabase/database.types";

type IntelInsert = Database["public"]["Tables"]["intel_items"]["Insert"];
type VulnInsert = Database["public"]["Tables"]["vulnerabilities"]["Insert"];
type BreachInsert = Database["public"]["Tables"]["breaches"]["Insert"];

const CVE_RE = /\bCVE-\d{4}-\d{3,7}\b/i;

/** Map an enriched item to its DB target. Pure, exported for testability. */
export function routeEnriched(item: EnrichedItem): "intel" | "vuln" | "breach" {
  if (item.itemType === "vuln") return "vuln";
  if (item.itemType === "breach") return "breach";
  return "intel";
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export type IngestResult = {
  runId: string;
  status: "success" | "error";
  itemsAdded: number;
  candidates: number;
  errors: string[];
};

/**
 * Full ingestion run: pull feeds, dedup, enrich, write to Supabase via the
 * service role, and record a refresh_runs row. Never throws for feed/LLM
 * problems; only a hard failure (e.g. DB unreachable) marks the run "error".
 */
export async function runIngest(): Promise<IngestResult> {
  const db = createAdminClient();
  const errors: string[] = [];

  const { data: run, error: runErr } = await db
    .from("refresh_runs")
    .insert({ status: "running" })
    .select("id")
    .single();
  if (runErr || !run) {
    throw new Error(`Failed to open refresh run: ${runErr?.message}`);
  }
  const runId = run.id;

  try {
    // Reference data ---------------------------------------------------------
    const [{ data: sources }, { data: actors }, { data: adversaries }] =
      await Promise.all([
        db.from("sources").select("id, name, feed_url, category").eq("active", true),
        db.from("actors").select("id, nexus"),
        db
          .from("adversaries")
          .select(
            "name, animal_classifier, description, short_description, community_identifiers, internal_alternative_names",
          ),
      ]);

    const adversaryGroups = buildGroupsFromAdversaries(adversaries ?? []);

    const sourceIdByName = new Map(
      (sources ?? []).map((s) => [s.name, s.id]),
    );
    const actorIdByNexus = new Map(
      (actors ?? []).map((a) => [a.nexus, a.id]),
    );

    const feedSources: FeedSource[] = (sources ?? [])
      .filter((s) => s.feed_url)
      .map((s) => ({ name: s.name, feed_url: s.feed_url, category: s.category }));

    // Existing dedup hashes across all target tables ------------------------
    const [intelHashes, vulnHashes, breachHashes] = await Promise.all([
      db.from("intel_items").select("raw_hash"),
      db.from("vulnerabilities").select("raw_hash"),
      db.from("breaches").select("raw_hash"),
    ]);
    const existing = new Set<string>([
      ...(intelHashes.data ?? []).map((r) => r.raw_hash),
      ...(vulnHashes.data ?? []).map((r) => r.raw_hash),
      ...(breachHashes.data ?? []).map((r) => r.raw_hash),
    ]);

    // Pull + augment ---------------------------------------------------------
    const { candidates: feedCandidates, errors: feedErrors } =
      await pullAllFeeds(feedSources);
    errors.push(...feedErrors);

    const search = selectSearchProvider();
    const searchCandidates =
      search.name === "noop" ? [] : await search.search("nation-state cyber");

    const allCandidates = [...feedCandidates, ...searchCandidates];
    const fresh = selectNewCandidates(allCandidates, existing);

    // Enrich (drop nulls) ----------------------------------------------------
    const enricher = selectEnricher(adversaryGroups);
    const enrichedNullable = await mapWithConcurrency(fresh, 6, (c) =>
      enricher.enrich(c),
    );
    const enriched = enrichedNullable.filter(
      (e): e is EnrichedItem => e !== null,
    );

    // Partition + insert -----------------------------------------------------
    const intelRows: IntelInsert[] = [];
    const vulnRows: VulnInsert[] = [];
    const breachRows: BreachInsert[] = [];

    for (const item of enriched) {
      const publishedDate = item.publishedAt.toISOString().slice(0, 10);
      const sourceId = sourceIdByName.get(item.sourceName) ?? null;
      let route = routeEnriched(item);

      // A "vuln" without a CVE id is really a report.
      const cveMatch = `${item.title} ${item.description ?? ""}`.match(CVE_RE);
      if (route === "vuln" && !cveMatch) route = "intel";

      if (route === "vuln") {
        vulnRows.push({
          cve_id: cveMatch![0].toUpperCase(),
          target: item.title.slice(0, 200),
          status: item.confidence ?? "suspected",
          detail: item.description,
          url: item.url,
          source_name: item.sourceName,
          source_id: sourceId,
          raw_hash: item.rawHash,
          added_at: publishedDate,
        });
      } else if (route === "breach") {
        breachRows.push({
          org_name: item.title.slice(0, 200),
          event_date_label: publishedDate,
          event_date: publishedDate,
          summary: item.description,
          source_name: item.sourceName,
          source_id: sourceId,
          url: item.url,
          raw_hash: item.rawHash,
        });
      } else {
        intelRows.push({
          actor_id: item.nexus ? (actorIdByNexus.get(item.nexus) ?? null) : null,
          title: item.title,
          description: item.description,
          url: item.url,
          published_at: publishedDate,
          confidence: item.confidence,
          crowdstrike_adversary: item.crowdstrikeAdversary,
          source_name: item.sourceName,
          source_id: sourceId,
          item_type: item.itemType,
          raw_hash: item.rawHash,
        });
      }
    }

    let added = 0;
    if (intelRows.length > 0) {
      const { data, error } = await db
        .from("intel_items")
        .upsert(intelRows, { onConflict: "raw_hash", ignoreDuplicates: true })
        .select("id");
      if (error) errors.push(`intel_items insert: ${error.message}`);
      else added += data?.length ?? 0;
    }
    if (vulnRows.length > 0) {
      const { data, error } = await db
        .from("vulnerabilities")
        .upsert(vulnRows, { onConflict: "raw_hash", ignoreDuplicates: true })
        .select("id");
      if (error) errors.push(`vulnerabilities insert: ${error.message}`);
      else added += data?.length ?? 0;
    }
    if (breachRows.length > 0) {
      const { data, error } = await db
        .from("breaches")
        .upsert(breachRows, { onConflict: "raw_hash", ignoreDuplicates: true })
        .select("id");
      if (error) errors.push(`breaches insert: ${error.message}`);
      else added += data?.length ?? 0;
    }

    // Keep-most-recent behaviour: mark actors quiet when they have no items in
    // the 30-day window, active otherwise. Existing rows are never deleted.
    await refreshActorStatuses(db);

    await db
      .from("refresh_runs")
      .update({
        finished_at: new Date().toISOString(),
        items_added: added,
        status: "success",
        log: JSON.stringify({
          candidates: allCandidates.length,
          fresh: fresh.length,
          enriched: enriched.length,
          added,
          enricher: enricher.name,
          errors: errors.slice(0, 50),
        }),
      })
      .eq("id", runId);

    return {
      runId,
      status: "success",
      itemsAdded: added,
      candidates: allCandidates.length,
      errors,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .from("refresh_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: "error",
        log: JSON.stringify({ error: message, errors }),
      })
      .eq("id", runId);
    return {
      runId,
      status: "error",
      itemsAdded: 0,
      candidates: 0,
      errors: [message, ...errors],
    };
  }
}

async function refreshActorStatuses(
  db: ReturnType<typeof createAdminClient>,
): Promise<void> {
  const { data: actors } = await db.from("actors").select("id");
  if (!actors) return;
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  await Promise.all(
    actors.map(async (a) => {
      const { count } = await db
        .from("intel_items")
        .select("id", { count: "exact", head: true })
        .eq("actor_id", a.id)
        .eq("item_type", "actor_activity")
        .gte("published_at", cutoff);
      await db
        .from("actors")
        .update({ status: (count ?? 0) > 0 ? "active" : "quiet" })
        .eq("id", a.id);
    }),
  );
}
