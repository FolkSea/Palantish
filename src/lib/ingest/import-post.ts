import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  scrapeArticle,
  scrapeArticleWithAI,
  siteIdentity,
  type ScrapedArticle,
} from "./scrape";
import { selectEnricher } from "./enrich/select";
import { linkLabelsToItem } from "./labels";
import { recordLabels } from "@/lib/agent/memory";
import { toAscii } from "@/lib/text";
import { buildGroupsFromAdversaries } from "./adversaries";
import { computeHash } from "./dedup";
import { computeAdversaryLabel, sortGroups } from "./enrich/rules";
import { findCve, resolveReportKind, type ReportKind } from "./routing";
import { NEXUS_COUNTRY } from "@/lib/actor-classify";
import type { EnrichedItem, RawCandidate } from "./types";
import type { Database } from "@/lib/supabase/database.types";

type IntelInsert = Database["public"]["Tables"]["intel_items"]["Insert"];

// Fields needed to open the imported item in the report modal. Shape matches
// the client ReportModalData. Every import is a report now, so always set.
export type ImportedReport = {
  title: string;
  url: string | null;
  description: string | null;
  sourceName: string | null;
  date: string | null;
  adversary: string | null;
  confidence: string | null;
  rawHash: string;
};

export type ImportResult =
  | {
      ok: true;
      title: string;
      route: ReportKind;
      itemType: string;
      sourceName: string;
      sourceCreated: boolean;
      report: ImportedReport;
    }
  | { ok: false; error: string; recoverable?: boolean };

function domainOf(u: string | null): string {
  if (!u) return "";
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Ensure a source name is unique against the existing catalogue. */
function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`)) n += 1;
  return `${base} (${n})`;
}

/**
 * Persist an already-extracted article: attach it to a source (creating a manual
 * source when the blog is not yet tracked), classify it with the same enricher
 * the pipeline uses, and store it. Manual imports are always kept even if the
 * classifier would drop them as low-signal; the classification only drives
 * routing and badges.
 *
 * The executive summary is deliberately NOT regenerated here.
 */
export async function ingestArticle(article: ScrapedArticle): Promise<ImportResult> {
  const db = createAdminClient();

  // Resolve the source by domain, or create a manual one.
  const { data: sources } = await db
    .from("sources")
    .select("id, name, url, category, feed_url");
  const existing = sources ?? [];
  let source = existing.find(
    (s) =>
      domainOf(s.feed_url) === article.domain ||
      domainOf(s.url) === article.domain,
  );
  let sourceCreated = false;
  if (!source) {
    const origin = (() => {
      try {
        return new URL(article.finalUrl).origin;
      } catch {
        return article.finalUrl;
      }
    })();
    const name = uniqueName(article.siteName, new Set(existing.map((s) => s.name)));
    const { data: created, error } = await db
      .from("sources")
      .insert({
        name,
        url: origin,
        category: "news",
        feed_type: "manual",
        feed_url: null,
        active: true,
      })
      .select("id, name, url, category, feed_url")
      .single();
    if (error || !created) {
      return { ok: false, error: `Could not add the source: ${error?.message}` };
    }
    source = created;
    sourceCreated = true;
  }

  // Dedup: all reports live in intel_items now.
  const rawHash = computeHash(article.title, article.finalUrl);
  const [iDup, delDup] = await Promise.all([
    db.from("intel_items").select("id", { count: "exact", head: true }).eq("raw_hash", rawHash),
    db.from("deleted_items").select("raw_hash", { count: "exact", head: true }).eq("raw_hash", rawHash),
  ]);
  if ((iDup.count ?? 0) > 0) {
    return { ok: false, error: "That post has already been imported." };
  }
  if ((delDup.count ?? 0) > 0) {
    return { ok: false, error: "That post was deleted and will not be re-imported." };
  }

  // Classify with the shared enricher (LLM when configured, else rules).
  const { data: adversaries } = await db
    .from("adversaries")
    .select(
      "name, nexus, country, motivation, community_identifiers, internal_alternative_names",
    );
  const adversaryGroups = buildGroupsFromAdversaries(adversaries ?? []);
  const enricher = selectEnricher(adversaryGroups);
  const candidate: RawCandidate = {
    title: article.title,
    url: article.finalUrl,
    description: article.description,
    publishedAt: article.publishedAt,
    sourceName: source.name,
    sourceCategory: source.category,
  };
  const enriched: EnrichedItem = (await enricher.enrich(candidate)) ?? {
    title: article.title,
    description: article.description,
    url: article.finalUrl,
    publishedAt: article.publishedAt ?? new Date(),
    nexus: null,
    itemType: "report",
    confidence: "suspected",
    crowdstrikeAdversary: null,
    sourceName: source.name,
    rawHash,
    labels: [],
  };

  const publishedDate = enriched.publishedAt.toISOString().slice(0, 10);
  const cveId = findCve(enriched);

  // Attribute: prefer the matched adversary's classification, else the nexus.
  const adv = enriched.crowdstrikeAdversary
    ? (adversaries ?? []).find(
        (a) =>
          (a.name ?? "").toLowerCase() ===
          enriched.crowdstrikeAdversary!.toLowerCase(),
      )
    : undefined;
  let motivation: string | null = null;
  let country: string | null = null;
  if (adv?.motivation?.[0]) {
    motivation = adv.motivation[0];
    country = adv.country ?? null;
  } else if (enriched.nexus && enriched.nexus !== "other") {
    motivation = "nation_state";
    country = NEXUS_COUNTRY[enriched.nexus] ?? null;
  }

  const kind = resolveReportKind(enriched, motivation !== null, !!cveId);
  const isExploit = kind === "exploit" && !!cveId;
  const adversaryLabel = computeAdversaryLabel(
    enriched.crowdstrikeAdversary,
    enriched.nexus,
    enriched.title,
    enriched.description,
    sortGroups(adversaryGroups),
  );
  const title = isExploit ? cveId! : enriched.title;
  const confidence = isExploit ? null : "medium";

  const row: IntelInsert = {
    kind,
    motivation,
    country,
    title,
    description: enriched.description,
    url: enriched.url,
    published_at: publishedDate,
    confidence,
    crowdstrike_adversary: enriched.crowdstrikeAdversary,
    adversary_label: adversaryLabel,
    cve_id: isExploit ? cveId : null,
    target: isExploit ? enriched.title.slice(0, 200) : null,
    exploit_status: isExploit ? enriched.confidence ?? "suspected" : null,
    source_name: source.name,
    source_id: source.id,
    item_type: enriched.itemType,
    raw_hash: rawHash,
  };
  const { data: insertedRow, error } = await db
    .from("intel_items")
    .upsert(row, { onConflict: "raw_hash", ignoreDuplicates: true })
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: `Insert failed: ${error.message}` };

  // Attach the triage labels to the newly-imported item and remember them, so
  // the taxonomy stays consistent with the feed pipeline. Non-fatal.
  if (insertedRow && enriched.labels.length) {
    try {
      await linkLabelsToItem(db, insertedRow.id, enriched.labels);
      await recordLabels(db, enriched.labels);
    } catch {
      // A labelling failure must not fail the import.
    }
  }

  const report: ImportedReport = {
    title,
    url: enriched.url,
    description: enriched.description,
    sourceName: source.name,
    date: publishedDate,
    adversary: adversaryLabel,
    confidence,
    rawHash,
  };

  return {
    ok: true,
    title: enriched.title,
    route: kind,
    itemType: enriched.itemType,
    sourceName: source.name,
    sourceCreated,
    report,
  };
}

/** Default path: heuristic scrape of the URL, then ingest. */
export async function importBlogPost(rawUrl: string): Promise<ImportResult> {
  return ingestArticle(await scrapeArticle(rawUrl));
}

/** Fallback: let the LLM read the fetched page, then ingest. */
export async function importBlogPostWithAI(rawUrl: string): Promise<ImportResult> {
  return ingestArticle(await scrapeArticleWithAI(rawUrl));
}

/**
 * Fallback: ingest a title + body the user pasted from the blog (no fetch). The
 * URL is still used to attach/create the source and as the item link.
 */
export async function importPastedPost(
  rawUrl: string,
  title: string,
  body: string,
): Promise<ImportResult> {
  const { finalUrl, domain, siteName } = siteIdentity(rawUrl);
  const cleanTitle = toAscii(title).trim();
  if (!cleanTitle) return { ok: false, error: "A title is required." };
  const cleanBody = toAscii(body).replace(/\s+/g, " ").trim();
  const article: ScrapedArticle = {
    title: cleanTitle,
    description: cleanBody ? cleanBody.slice(0, 2000) : null,
    publishedAt: null,
    finalUrl,
    siteName,
    domain,
  };
  return ingestArticle(article);
}
