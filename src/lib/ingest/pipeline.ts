import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { pullAllFeeds, type FeedSource } from "./feeds";
import { selectNewCandidates } from "./dedup";
import { selectEnricher } from "./enrich/select";
import { selectSearchProvider } from "./search";
import { buildGroupsFromAdversaries } from "./adversaries";
import {
  computeAdversaryLabel,
  sortGroups,
  GROUP_TABLE,
} from "./enrich/rules";
import { updateFeedHealth } from "./feed-health";
import { ilog } from "./log";
import { fetchArticleText } from "./scrape";
import { indicatorRows, linkIocsToItem } from "./iocs";
import { extractIndicators, sourceDomain } from "@/lib/report-indicators";
import { NEXUS_COUNTRY } from "@/lib/actor-classify";
import { generateAndStoreSummary } from "@/lib/summary/generate";
import type { EnrichReport } from "./enrich/hybrid";
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
export async function runIngest(
  options?: { sourceIds?: string[] },
): Promise<IngestResult> {
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
  ilog(
    `ingest run ${runId} started${
      options?.sourceIds
        ? ` (scoped to ${options.sourceIds.length} source(s))`
        : ""
    }`,
  );

  try {
    // Reference data ---------------------------------------------------------
    // A scoped run (the single-feed "Update" action) targets the given source
    // ids regardless of their active flag; a full run pulls all active sources.
    const sourcesSelect = db
      .from("sources")
      .select("id, name, url, feed_url, category");
    const [{ data: sources }, { data: adversaries }] = await Promise.all([
      options?.sourceIds
        ? sourcesSelect.in("id", options.sourceIds)
        : sourcesSelect.eq("active", true),
      db
        .from("adversaries")
        .select(
          "name, nexus, country, motivation, community_identifiers, internal_alternative_names",
        ),
    ]);

    const adversaryGroups = buildGroupsFromAdversaries(adversaries ?? []);
    // Group list used to derive an adversary label when there is no CS name.
    const labelGroups = sortGroups([...adversaryGroups, ...GROUP_TABLE]);

    const sourceIdByName = new Map(
      (sources ?? []).map((s) => [s.name, s.id]),
    );
    // Adversary name -> its stored classification, to attribute matched items.
    const advByName = new Map(
      (adversaries ?? []).map((a) => [
        (a.name ?? "").toLowerCase(),
        { motivation: a.motivation?.[0] ?? null, country: a.country ?? null },
      ]),
    );

    const feedSources: FeedSource[] = (sources ?? [])
      .filter((s) => s.feed_url)
      .map((s) => ({ name: s.name, feed_url: s.feed_url, category: s.category }));
    ilog(`pulling ${feedSources.length} active feeds...`);

    // Existing dedup hashes across all target tables ------------------------
    const [intelHashes, vulnHashes, breachHashes, deletedHashes] =
      await Promise.all([
        db.from("intel_items").select("raw_hash"),
        db.from("vulnerabilities").select("raw_hash"),
        db.from("breaches").select("raw_hash"),
        // Blocklist: items an operator permanently deleted must not return.
        db.from("deleted_items").select("raw_hash"),
      ]);
    const existing = new Set<string>([
      ...(intelHashes.data ?? []).map((r) => r.raw_hash),
      ...(vulnHashes.data ?? []).map((r) => r.raw_hash),
      ...(breachHashes.data ?? []).map((r) => r.raw_hash),
      ...(deletedHashes.data ?? []).map((r) => r.raw_hash),
    ]);

    // Pull + augment ---------------------------------------------------------
    const {
      candidates: feedCandidates,
      errors: feedErrors,
      health,
    } = await pullAllFeeds(feedSources);
    errors.push(...feedErrors);

    // Record per-feed freshness for the stale-feed warning (non-fatal).
    try {
      await updateFeedHealth(db, health);
    } catch (err) {
      errors.push(
        `feed_health: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Global search augmentation only applies to a full run, not a scoped
    // single-feed update.
    const search = selectSearchProvider();
    const searchCandidates =
      options?.sourceIds || search.name === "noop"
        ? []
        : await search.search("nation-state cyber");

    const allCandidates = [...feedCandidates, ...searchCandidates];
    ilog(
      `pulled ${feedCandidates.length} feed items (${feedErrors.length} feed errors)`,
    );
    const fresh = selectNewCandidates(allCandidates, existing);
    ilog(
      `${allCandidates.length} candidates, ${fresh.length} new after dedup; enriching (concurrency 6)...`,
    );

    // Enrich (drop nulls) ----------------------------------------------------
    // Per-item logging: which items the rules classify locally vs escalate to
    // the LLM, and whether each is kept or dropped.
    const tally = { rulesKeep: 0, rulesDrop: 0, llmKeep: 0, llmDrop: 0 };
    const report: EnrichReport = (r) => {
      if (r.via === "rules") r.outcome === "keep" ? tally.rulesKeep++ : tally.rulesDrop++;
      else r.outcome === "keep" ? tally.llmKeep++ : tally.llmDrop++;
      ilog(
        `  ${r.via === "llm" ? "LLM " : "rules"} ${r.outcome === "keep" ? "keep" : "drop"}` +
          `${r.itemType ? ` [${r.itemType}]` : ""}: ${r.title.slice(0, 90)}`,
      );
    };
    const enricher = selectEnricher(adversaryGroups, report);
    const enrichedNullable = await mapWithConcurrency(fresh, 6, (c) =>
      enricher.enrich(c),
    );
    const enriched = enrichedNullable.filter(
      (e): e is EnrichedItem => e !== null,
    );
    ilog(
      `enrichment done: rules kept ${tally.rulesKeep}, rules dropped ${tally.rulesDrop}, ` +
        `LLM kept ${tally.llmKeep}, LLM dropped ${tally.llmDrop}`,
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
        // Attribute the item: prefer the matched adversary's own classification,
        // otherwise derive it from the enriched nexus.
        const adv = item.crowdstrikeAdversary
          ? advByName.get(item.crowdstrikeAdversary.toLowerCase())
          : undefined;
        let motivation: string | null = null;
        let country: string | null = null;
        if (adv?.motivation) {
          motivation = adv.motivation;
          country = adv.country;
        } else if (item.nexus && item.nexus !== "other") {
          motivation = "nation_state";
          country = NEXUS_COUNTRY[item.nexus] ?? null;
        }
        intelRows.push({
          motivation,
          country,
          title: item.title,
          description: item.description,
          url: item.url,
          published_at: publishedDate,
          confidence: item.confidence,
          crowdstrike_adversary: item.crowdstrikeAdversary,
          // Store the derived adversary label so it can be edited later.
          adversary_label: computeAdversaryLabel(
            item.crowdstrikeAdversary,
            item.nexus,
            item.title,
            item.description,
            labelGroups,
          ),
          source_name: item.sourceName,
          source_id: sourceId,
          item_type: item.itemType,
          raw_hash: item.rawHash,
        });
      }
    }

    ilog(
      `inserting: ${intelRows.length} intel, ${vulnRows.length} vuln, ${breachRows.length} breach`,
    );
    let added = 0;
    // Newly-inserted reports, for IOC extraction below.
    let insertedIntel: {
      id: string;
      url: string | null;
      title: string;
      description: string | null;
    }[] = [];
    if (intelRows.length > 0) {
      const { data, error } = await db
        .from("intel_items")
        .upsert(intelRows, { onConflict: "raw_hash", ignoreDuplicates: true })
        .select("id, url, title, description");
      if (error) errors.push(`intel_items insert: ${error.message}`);
      else {
        insertedIntel = data ?? [];
        added += insertedIntel.length;
      }
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

    ilog(`inserted ${added} new items`);

    // Populate IOCs for the new reports: fetch each article body, extract
    // indicators (IP / domain / URI / file hash), and link them so they are
    // stored and searchable without anyone opening the report. Bounded
    // concurrency; per-item failures are non-fatal (the report just has no IOCs).
    const withUrl = insertedIntel.filter((i) => i.url);
    if (withUrl.length > 0) {
      // Known blog/source domains, so a source's own domain is never an IOC.
      const sourceDomains = new Set<string>();
      for (const s of sources ?? []) {
        for (const d of [sourceDomain(s.url), sourceDomain(s.feed_url)]) {
          if (d) sourceDomains.add(d);
        }
      }
      ilog(`extracting IOCs for ${withUrl.length} new reports...`);
      let iocLinks = 0;
      let iocFailed = 0;
      await mapWithConcurrency(withUrl, 4, async (item) => {
        try {
          const body = await fetchArticleText(item.url as string);
          // Exclude the whole source catalogue plus this report's own domain.
          const exclude = new Set(sourceDomains);
          const own = sourceDomain(item.url);
          if (own) exclude.add(own);
          const indicators = extractIndicators(
            `${item.title} ${item.description ?? ""} ${body}`,
            exclude,
          );
          const rows = indicatorRows(indicators);
          if (rows.length > 0) iocLinks += await linkIocsToItem(db, item.id, rows);
        } catch {
          iocFailed++;
        }
      });
      ilog(
        `IOC extraction done: ${iocLinks} links across ${withUrl.length} reports (${iocFailed} fetch failures)`,
      );
    }

    // Recalculate the executive summary on every completed run so it always
    // reflects the latest data and the current 24h / 7d windows. Non-fatal.
    ilog("recalculating executive summary...");
    try {
      await generateAndStoreSummary(db);
    } catch (err) {
      errors.push(
        `summary: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    ilog(`ingest run ${runId} finished: ${added} added, ${errors.length} errors`);

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
    ilog(`ingest run ${runId} FAILED: ${message}`);
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

