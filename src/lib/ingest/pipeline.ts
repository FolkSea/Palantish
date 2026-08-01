import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { pullAllFeeds, type FeedSource } from "./feeds";
import { selectNewCandidates, computeHash } from "./dedup";
import { selectEnricher } from "./enrich/select";
import { selectSearchProvider } from "./search";
import { buildGroupsFromAdversaries } from "./adversaries";
import {
  classifyExploitStatus,
  computeAdversaryLabel,
  isVulnAdvisory,
  sortGroups,
} from "./enrich/rules";
import { findCve, resolveReportKind } from "./routing";
import { updateFeedHealth } from "./feed-health";
import { serverEnv } from "@/lib/env";
import { AnalystAgent } from "@/lib/agent/analyst";
import {
  loadMemoryBrief,
  readMemory,
  recordLabels,
  upsertMemoryNotes,
} from "@/lib/agent/memory";
import { ilog } from "./log";
import { fetchArticleText } from "./scrape";
import { indicatorRows, linkIocsToItem } from "./iocs";
import { linkLabelsToItem } from "./labels";
import { reconcileIndicators } from "@/lib/agent/ioc-validate";
import { loadIocAllowlist } from "./allowlist";
import { extractIndicators, sourceDomain } from "@/lib/report-indicators";
import { NEXUS_COUNTRY } from "@/lib/actor-classify";
import { generateAndStoreSummary } from "@/lib/summary/generate";
import type { EnrichReport } from "./enrich/hybrid";
import type { EnrichedItem } from "./types";
import type { Database } from "@/lib/supabase/database.types";

type IntelInsert = Database["public"]["Tables"]["intel_items"]["Insert"];

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
  /** Candidates left unprocessed when the run stopped on its time budget; the
   * caller chains another run while this is above zero. */
  deferred: number;
  errors: string[];
};

/**
 * Full ingestion run: pull feeds, dedup, enrich, write to Supabase via the
 * service role, and record a refresh_runs row. Never throws for feed/LLM
 * problems; only a hard failure (e.g. DB unreachable) marks the run "error".
 */
// Soft wall-clock budget for a single run. Serverless invocations are capped at
// 5 minutes; under llm-first a big backlog cannot finish in one go, so the run
// stops starting new batches past this budget, finalises cleanly (summary /
// memory / run status), and leaves the remainder for the next trigger or cron
// (dedup skips what was already inserted). Override with INGEST_RUN_BUDGET_MS.
// Leaves headroom under the 300s function cap for everything that runs AFTER
// the batch loop - source stats, dropped items, label memory, the end-of-run
// reflection and the summary. Those last two are large single LLM calls; when
// the budget left them too little time the reflection simply timed out and no
// memory was ever written.
const RUN_BUDGET_MS = Number(process.env.INGEST_RUN_BUDGET_MS) || 180000;

// How many candidates are enriched concurrently. Each is one LLM call that
// fetches and analyses the article, so this is I/O-bound - the ceiling is the
// Anthropic rate limit, not local CPU. BATCH_SIZE defaults to this so a batch is
// exactly one wave. Override with INGEST_ENRICH_CONCURRENCY.
const ENRICH_CONCURRENCY = Number(process.env.INGEST_ENRICH_CONCURRENCY) || 6;

export async function runIngest(
  options?: { sourceIds?: string[] },
): Promise<IngestResult> {
  const runStartMs = Date.now();
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
    // Catalogue-derived group list used to derive an adversary label.
    const labelGroups = sortGroups(adversaryGroups);

    const sourceIdByName = new Map(
      (sources ?? []).map((s) => [s.name, s.id]),
    );
    // Source category drives the "government advisory -> confirmed" exploit rule.
    const sourceCategoryByName = new Map(
      (sources ?? []).map((s) => [s.name, s.category]),
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

    const [intelHashes, deletedHashes] = await Promise.all([
      db.from("intel_items").select("raw_hash"),
      // Blocklist: items an operator permanently deleted must not return.
      db.from("deleted_items").select("raw_hash"),
    ]);
    const existing = new Set<string>([
      ...(intelHashes.data ?? []).map((r) => r.raw_hash),
      ...(deletedHashes.data ?? []).map((r) => r.raw_hash),
    ]);

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

    // Per-item logging: which items the rules classify locally vs escalate to
    // the LLM, and whether each is kept or dropped.
    const tally = { rulesKeep: 0, rulesDrop: 0, llmKeep: 0, llmDrop: 0 };
    // Dropped candidates are recorded for the audit view (Settings).
    const dropped: {
      title: string;
      url: string | null;
      source_name: string | null;
      reason: string | null;
    }[] = [];
    const report: EnrichReport = (r) => {
      if (r.via === "rules") {
        if (r.outcome === "keep") tally.rulesKeep++;
        else tally.rulesDrop++;
      } else if (r.outcome === "keep") tally.llmKeep++;
      else tally.llmDrop++;
      if (r.outcome === "drop") {
        dropped.push({
          title: r.title,
          url: r.url,
          source_name: r.sourceName ?? null,
          reason: r.reason ?? null,
        });
      }
      ilog(
        `  ${r.via === "llm" ? "LLM " : "rules"} ${r.outcome === "keep" ? "keep" : "drop"}` +
          `${r.itemType ? ` [${r.itemType}]` : ""}: ${r.title.slice(0, 90)}`,
      );
    };
    // The analyst agent's accumulated knowledge, injected into every triage.
    const memoryBrief = await loadMemoryBrief(db);
    const enricher = selectEnricher(adversaryGroups, report, memoryBrief);
    // Process in batches so progress persists incrementally: each batch is
    // enriched, inserted, and IOC-populated before the next begins. If the run
    // is killed (the serverless path is capped at 5 min), everything already
    // inserted is kept instead of the whole run being lost - important under
    // llm-first, where every item costs an LLM call. Items also appear on the
    // dashboard as the run progresses.
    //
    // Sized to ONE enrichment wave (see the concurrency below): the run-budget
    // check only runs between batches, so the first batch always completes and
    // must fit inside maxDuration on its own. Web-fetch triage takes ~60-100s
    // per item, so a batch of one wave is bounded by a single item's worst case
    // rather than a multiple of it. Override with INGEST_BATCH_SIZE.
    const BATCH_SIZE = Number(process.env.INGEST_BATCH_SIZE) || ENRICH_CONCURRENCY;

    // A source's own domain is never an IOC; compute the exclusion set once, and
    // fold in the operator-configurable allowlist (vendor / press / TI domains).
    const allowlist = await loadIocAllowlist(db);
    const allowIps = allowlist.ips;
    const sourceDomains = new Set<string>(allowlist.domains);
    for (const s of sources ?? []) {
      for (const d of [sourceDomain(s.url), sourceDomain(s.feed_url)]) {
        if (d) sourceDomains.add(d);
      }
    }

    // Build one intel_items row from an enriched item (attribution + kind).
    const buildRow = (item: EnrichedItem): IntelInsert => {
      const publishedDate = item.publishedAt.toISOString().slice(0, 10);
      const sourceId = sourceIdByName.get(item.sourceName) ?? null;

      // Attribute: prefer the matched adversary's classification, else the nexus.
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

      const cveId = findCve(item);
      const kind = resolveReportKind(item, motivation !== null, !!cveId);
      const isExploit = kind === "exploit" && !!cveId;

      return {
        kind,
        motivation,
        country,
        title: isExploit ? cveId! : item.title,
        description: item.description,
        url: item.url,
        published_at: publishedDate,
        // Reports carry an attribution confidence (Medium default); exploits use
        // exploit_status (poc/confirmed/suspected) instead.
        confidence: isExploit ? null : "medium",
        crowdstrike_adversary: item.crowdstrikeAdversary,
        // Store the derived adversary label so it can be edited later.
        adversary_label: computeAdversaryLabel(
          item.crowdstrikeAdversary,
          item.nexus,
          item.title,
          item.description,
          labelGroups,
        ),
        cve_id: isExploit ? cveId : null,
        target: isExploit ? item.title.slice(0, 200) : null,
        // Deterministic from the report text, not the LLM's confidence, so a
        // released PoC is graded "poc" regardless of the enricher in use.
        exploit_status: isExploit
          ? classifyExploitStatus(
              `${item.title} ${item.description ?? ""}`,
              sourceCategoryByName.get(item.sourceName),
            )
          : null,
        source_name: item.sourceName,
        source_id: sourceId,
        item_type: item.itemType,
        raw_hash: item.rawHash,
        // How the body was retrieved for analysis (web fetch vs feed/scrape),
        // and the LLM's summary of the fetched article. Refined post-insert for
        // items that fall back to the app-side scraper.
        retrieval_status: item.fetchStatus ?? null,
        report_summary: item.summary ?? null,
      };
    };

    let added = 0;
    let iocLinks = 0;
    let iocFailed = 0;
    let labelLinks = 0;
    // Every taxonomy label applied this run, recorded to memory at the end so the
    // agent reuses them next run (consistent labelling).
    const labelsUsed = new Set<string>();
    // Lightweight per-report facts for the analyst's end-of-run reflection.
    const reflectionInputs: {
      title: string;
      kind: string;
      adversary: string | null;
    }[] = [];
    // Per-feed keep/drop tally, accumulated into the sources table after the run.
    const perSource = new Map<string, { kept: number; dropped: number }>();

    // Candidates left unprocessed when the run stops on its time budget. The
    // caller uses this to chain another run (the cron fires only once a day, so
    // one invocation cannot drain a full backlog).
    let deferred = 0;

    const batches = Math.ceil(fresh.length / BATCH_SIZE);
    for (let b = 0; b < batches; b++) {
      // Stop starting new batches once the budget is spent (but always do at
      // least one). The unprocessed candidates are simply picked up next run.
      if (b > 0 && Date.now() - runStartMs > RUN_BUDGET_MS) {
        deferred = fresh.length - b * BATCH_SIZE;
        errors.push(
          `time budget reached: ${b} of ${batches} batches processed, ` +
            `${deferred} candidates deferred to the next run`,
        );
        ilog(
          `run budget reached after ${b}/${batches} batches; ${added} added, ` +
            `deferring the rest to the next run`,
        );
        break;
      }
      const batch = fresh.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);

      // Enrich this batch - one wave by default; llm-first makes each an LLM
      // call that web-fetches and analyses the article.
      const enrichedNullable = await mapWithConcurrency(
        batch,
        ENRICH_CONCURRENCY,
        (c) => enricher.enrich(c),
      );
      // Per-feed keep/drop tally: a null result was dropped, else kept.
      for (let i = 0; i < batch.length; i++) {
        const s = perSource.get(batch[i].sourceName) ?? { kept: 0, dropped: 0 };
        if (enrichedNullable[i]) s.kept++;
        else s.dropped++;
        perSource.set(batch[i].sourceName, s);
      }
      const enriched = enrichedNullable.filter(
        (e): e is EnrichedItem => e !== null,
      );

      const batchRows = enriched.map(buildRow);
      for (const r of batchRows)
        reflectionInputs.push({
          title: r.title,
          kind: r.kind ?? "other",
          adversary: r.crowdstrike_adversary ?? r.adversary_label ?? null,
        });
      // Map each report's raw_hash to its triage labels, so they can be attached
      // to the rows that actually get inserted (dedup may drop some).
      const labelsByHash = new Map<string, string[]>(
        enriched.filter((e) => e.labels.length).map((e) => [e.rawHash, e.labels]),
      );
      // Map raw_hash to the enriched item so the IOC step can prefer the IOCs
      // Claude already extracted from the web-fetched article.
      const enrichedByHash = new Map<string, EnrichedItem>(
        enriched.map((e) => [e.rawHash, e]),
      );

      // Insert this batch before moving on, so progress survives a timeout.
      let insertedIntel: {
        id: string;
        url: string | null;
        title: string;
        description: string | null;
        kind: string;
        source_name: string | null;
        raw_hash: string;
      }[] = [];
      if (batchRows.length > 0) {
        const { data, error } = await db
          .from("intel_items")
          .upsert(batchRows, { onConflict: "raw_hash", ignoreDuplicates: true })
          .select("id, url, title, description, kind, source_name, raw_hash");
        if (error) errors.push(`intel_items insert: ${error.message}`);
        else {
          insertedIntel = data ?? [];
          added += insertedIntel.length;
        }
      }

      // Attach the triage labels to the inserted reports (find-or-create + link).
      // Per-item failures are non-fatal - the report just carries fewer labels.
      for (const item of insertedIntel) {
        const labels = labelsByHash.get(item.raw_hash);
        if (!labels?.length) continue;
        try {
          labelLinks += await linkLabelsToItem(db, item.id, labels);
          for (const l of labels) labelsUsed.add(l);
        } catch (err) {
          errors.push(
            `label link (${item.raw_hash}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // Populate IOCs. Prefer the indicators Claude already extracted from the
      // web-fetched article (validated + reconciled against the fetched text
      // here). Only reports whose body was NOT fetched full fall back to the
      // app-side scraper (+ reader proxy) - so each retrieval method runs at most
      // once. Per-item failures are non-fatal (the report just has no IOCs).
      await mapWithConcurrency(insertedIntel, 4, async (item) => {
        const src = enrichedByHash.get(item.raw_hash);
        const exclude = new Set(sourceDomains);
        const own = sourceDomain(item.url);
        if (own) exclude.add(own);

        // Web-fetch path: reconcile Claude's IOCs with the fetched text.
        if (src?.fetchStatus === "full" && src.llmIndicators) {
          try {
            const rows = reconcileIndicators(
              src.llmIndicators,
              src.mitreTechniques ?? [],
              src.fetchedText ?? null,
              { excludeDomains: exclude, excludeIps: allowIps },
            );
            if (rows.length > 0)
              iocLinks += await linkIocsToItem(db, item.id, rows);
          } catch {
            iocFailed++;
          }
          return; // web fetch already retrieved the body - do not also scrape
        }

        // Fallback path: app-side scraper for feed-only / rules items.
        if (!item.url) return;
        try {
          const body = await fetchArticleText(item.url);
          const indicators = extractIndicators(
            `${item.title} ${item.description ?? ""} ${body}`,
            exclude,
            allowIps,
          );
          const rows = indicatorRows(indicators);
          if (rows.length > 0)
            iocLinks += await linkIocsToItem(db, item.id, rows);
          // The scraper retrieved the body: mark feed_only (needs review) unless
          // triage already recorded a status.
          await db
            .from("intel_items")
            .update({ retrieval_status: "feed_only" })
            .eq("id", item.id)
            .is("retrieval_status", null);

          // A vulnerability advisory whose CVE only appears in the body (not the
          // title/description the classifier saw) lands in "other". Now that the
          // body has been read and a real CVE extracted, move it to the Exploits
          // section. Only unattributed "other" items are promoted.
          if (
            item.kind === "other" &&
            isVulnAdvisory(item.title) &&
            indicators.cves.length > 0
          ) {
            const text = `${item.title} ${item.description ?? ""} ${body}`;
            await db
              .from("intel_items")
              .update({
                kind: "exploit",
                item_type: "vuln",
                cve_id: indicators.cves[0].toUpperCase(),
                target: item.title.slice(0, 200),
                exploit_status: classifyExploitStatus(
                  text,
                  sourceCategoryByName.get(item.source_name ?? ""),
                ),
                confidence: null,
              })
              .eq("id", item.id);
          }
        } catch {
          iocFailed++;
          await db
            .from("intel_items")
            .update({ retrieval_status: "failed" })
            .eq("id", item.id)
            .is("retrieval_status", null);
        }
      });

      ilog(
        `batch ${b + 1}/${batches}: +${insertedIntel.length} inserted ` +
          `(running total ${added} of ${fresh.length})`,
      );
    }

    ilog(
      `enrichment done: rules kept ${tally.rulesKeep}, rules dropped ${tally.rulesDrop}, ` +
        `LLM kept ${tally.llmKeep}, LLM dropped ${tally.llmDrop}`,
    );
    ilog(
      `inserted ${added} new items; IOC extraction: ${iocLinks} links (${iocFailed} fetch failures); ` +
        `${labelLinks} labels linked`,
    );

    // Record this run's taxonomy labels to memory so the agent reuses them next
    // run (consistent labelling). Deterministic; non-fatal.
    if (labelsUsed.size > 0) {
      try {
        const n = await recordLabels(db, [...labelsUsed]);
        ilog(`analyst memory: ${n} labels recorded/refreshed`);
      } catch (err) {
        errors.push(
          `label memory: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Accumulate this run's per-feed keep/drop counts onto the sources table
    // (atomic add, so overlapping runs never lose increments).
    const statPayload = [...perSource.entries()]
      .map(([name, s]) => ({
        id: sourceIdByName.get(name) ?? null,
        kept: s.kept,
        dropped: s.dropped,
      }))
      .filter((s): s is { id: string; kept: number; dropped: number } => !!s.id);
    if (statPayload.length > 0) {
      const { error } = await db.rpc("bump_source_stats", { stats: statPayload });
      if (error) errors.push(`source stats: ${error.message}`);
      else ilog(`updated keep/drop stats for ${statPayload.length} feeds`);
    }

    // Record dropped candidates for the audit view (deduped by content hash).
    if (dropped.length > 0) {
      const seen = new Set<string>();
      const droppedRows = dropped
        .map((d) => ({
          raw_hash: computeHash(d.title, d.url ?? ""),
          title: d.title.slice(0, 500),
          url: d.url,
          source_name: d.source_name,
          reason: d.reason,
        }))
        .filter((r) => (seen.has(r.raw_hash) ? false : seen.add(r.raw_hash)));
      const { error } = await db
        .from("dropped_items")
        .upsert(droppedRows, { onConflict: "raw_hash", ignoreDuplicates: true });
      if (error) errors.push(`dropped_items insert: ${error.message}`);
      else ilog(`recorded ${droppedRows.length} dropped candidates`);
    }

    // The analyst reflects on this run's kept reports and updates its long-term
    // memory of adversaries and trends, so future triage/summaries build on it.
    // Runs before the summary so the summary sees the freshest memory. Non-fatal.
    const apiKey = serverEnv.anthropicApiKey;
    if (apiKey && reflectionInputs.length > 0) {
      ilog("analyst reflecting on the run (updating memory)...");
      try {
        const agent = new AnalystAgent(apiKey, memoryBrief);
        const existing = (await readMemory(db)).map((n) => n.subject);
        const updates = await agent.reflect(reflectionInputs.slice(0, 80), existing);
        const n = await upsertMemoryNotes(db, updates);
        ilog(`analyst memory: ${n} notes written/updated`);
      } catch (err) {
        errors.push(
          `memory: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Recalculate the executive summary on every completed run so it always
    // reflects the latest data and the current 24h / 7-30d windows. Non-fatal.
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
          enriched: reflectionInputs.length,
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
      deferred,
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
      deferred: 0,
      errors: [message, ...errors],
    };
  }
}
