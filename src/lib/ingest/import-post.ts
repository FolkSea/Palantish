import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  scrapeArticle,
  scrapeArticleWithAI,
  siteIdentity,
  type ScrapedArticle,
} from "./scrape";
import { selectEnricher } from "./enrich/llm";
import { toAscii } from "@/lib/text";
import { buildGroupsFromAdversaries } from "./adversaries";
import { computeHash } from "./dedup";
import type { EnrichedItem, RawCandidate } from "./types";
import type { Database } from "@/lib/supabase/database.types";

type IntelInsert = Database["public"]["Tables"]["intel_items"]["Insert"];
type VulnInsert = Database["public"]["Tables"]["vulnerabilities"]["Insert"];
type BreachInsert = Database["public"]["Tables"]["breaches"]["Insert"];

const CVE_RE = /\bCVE-\d{4}-\d{3,7}\b/i;

export type ImportResult =
  | {
      ok: true;
      title: string;
      route: "intel" | "vuln" | "breach";
      itemType: string;
      sourceName: string;
      sourceCreated: boolean;
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

  // Dedup across all three target tables.
  const rawHash = computeHash(article.title, article.finalUrl);
  const [iDup, vDup, bDup] = await Promise.all([
    db.from("intel_items").select("id", { count: "exact", head: true }).eq("raw_hash", rawHash),
    db.from("vulnerabilities").select("id", { count: "exact", head: true }).eq("raw_hash", rawHash),
    db.from("breaches").select("id", { count: "exact", head: true }).eq("raw_hash", rawHash),
  ]);
  if ((iDup.count ?? 0) + (vDup.count ?? 0) + (bDup.count ?? 0) > 0) {
    return { ok: false, error: "That post has already been imported." };
  }

  // Classify with the shared enricher (LLM when configured, else rules).
  const { data: adversaries } = await db
    .from("adversaries")
    .select(
      "name, animal_classifier, description, short_description, motivation, community_identifiers, internal_alternative_names",
    );
  const enricher = selectEnricher(buildGroupsFromAdversaries(adversaries ?? []));
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
  };

  // Route (mirrors the pipeline): a "vuln" without a CVE id is really a report.
  const publishedDate = enriched.publishedAt.toISOString().slice(0, 10);
  const cveMatch = `${enriched.title} ${enriched.description ?? ""}`.match(CVE_RE);
  let route: "intel" | "vuln" | "breach" =
    enriched.itemType === "vuln" ? "vuln" : enriched.itemType === "breach" ? "breach" : "intel";
  if (route === "vuln" && !cveMatch) route = "intel";

  if (route === "vuln") {
    const row: VulnInsert = {
      cve_id: cveMatch![0].toUpperCase(),
      target: enriched.title.slice(0, 200),
      status: enriched.confidence ?? "suspected",
      detail: enriched.description,
      url: enriched.url,
      source_name: source.name,
      source_id: source.id,
      raw_hash: rawHash,
      added_at: publishedDate,
    };
    const { error } = await db
      .from("vulnerabilities")
      .upsert(row, { onConflict: "raw_hash", ignoreDuplicates: true });
    if (error) return { ok: false, error: `Insert failed: ${error.message}` };
  } else if (route === "breach") {
    const row: BreachInsert = {
      org_name: enriched.title.slice(0, 200),
      event_date_label: publishedDate,
      event_date: publishedDate,
      summary: enriched.description,
      source_name: source.name,
      source_id: source.id,
      url: enriched.url,
      raw_hash: rawHash,
    };
    const { error } = await db
      .from("breaches")
      .upsert(row, { onConflict: "raw_hash", ignoreDuplicates: true });
    if (error) return { ok: false, error: `Insert failed: ${error.message}` };
  } else {
    const { data: actors } = await db.from("actors").select("id, nexus");
    const actorId = enriched.nexus
      ? ((actors ?? []).find((a) => a.nexus === enriched.nexus)?.id ?? null)
      : null;
    const row: IntelInsert = {
      actor_id: actorId,
      title: enriched.title,
      description: enriched.description,
      url: enriched.url,
      published_at: publishedDate,
      confidence: enriched.confidence,
      crowdstrike_adversary: enriched.crowdstrikeAdversary,
      source_name: source.name,
      source_id: source.id,
      item_type: enriched.itemType,
      raw_hash: rawHash,
    };
    const { error } = await db
      .from("intel_items")
      .upsert(row, { onConflict: "raw_hash", ignoreDuplicates: true });
    if (error) return { ok: false, error: `Insert failed: ${error.message}` };
  }

  return {
    ok: true,
    title: enriched.title,
    route,
    itemType: enriched.itemType,
    sourceName: source.name,
    sourceCreated,
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
