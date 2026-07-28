"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEmailAllowed } from "@/lib/env";
import {
  ingestArticle,
  importBlogPostWithAI,
  importPastedPost,
  type ImportResult,
} from "@/lib/ingest/import-post";
import {
  scrapeArticle,
  assertPublicHttpUrl,
  fetchArticleText,
} from "@/lib/ingest/scrape";
import { isThreatIntel } from "@/lib/relevance";

async function ensureAllowed(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) return "Not authorized.";
  return null;
}

function refreshDashboard() {
  // Refresh the dashboard (and settings source list) without touching the
  // cached executive summary.
  revalidatePath("/");
  revalidatePath("/settings");
}

export type ItemMutationResult = { ok: boolean; error?: string };

/**
 * Permanently delete an intel item from the database and add its content hash
 * to the blocklist so the ingest pipeline never re-imports it. Global (affects
 * every viewer), auth-checked.
 */
export async function deleteItemAction(
  rawHash: string,
): Promise<ItemMutationResult> {
  if (!rawHash) return { ok: false, error: "Missing item reference." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) {
    return { ok: false, error: "Not authorized." };
  }

  const db = createAdminClient();

  // The item lives in one of three tables (intel_items / breaches /
  // vulnerabilities); capture url + a title for the audit record, then remove
  // it wherever it is. raw_hash is unique across tables.
  let url: string | null = null;
  let title: string | null = null;
  const intel = await db
    .from("intel_items")
    .select("url, title")
    .eq("raw_hash", rawHash)
    .maybeSingle();
  if (intel.data) {
    url = intel.data.url;
    title = intel.data.title;
  } else {
    const breach = await db
      .from("breaches")
      .select("url, org_name")
      .eq("raw_hash", rawHash)
      .maybeSingle();
    if (breach.data) {
      url = breach.data.url;
      title = breach.data.org_name;
    } else {
      const vuln = await db
        .from("vulnerabilities")
        .select("url, cve_id")
        .eq("raw_hash", rawHash)
        .maybeSingle();
      if (vuln.data) {
        url = vuln.data.url;
        title = vuln.data.cve_id;
      }
    }
  }

  const del1 = await db.from("intel_items").delete().eq("raw_hash", rawHash);
  const del2 = await db.from("breaches").delete().eq("raw_hash", rawHash);
  const del3 = await db.from("vulnerabilities").delete().eq("raw_hash", rawHash);
  const delErr = del1.error ?? del2.error ?? del3.error;
  if (delErr) return { ok: false, error: delErr.message };

  const { error: blockErr } = await db.from("deleted_items").upsert(
    { raw_hash: rawHash, url, title, deleted_by: user.id },
    { onConflict: "raw_hash", ignoreDuplicates: true },
  );
  if (blockErr) return { ok: false, error: blockErr.message };

  revalidatePath("/");
  return { ok: true };
}

/**
 * Hide an item for the current user only. Persisted per-user; RLS ensures the
 * row is scoped to the authenticated user.
 */
export async function hideItemAction(
  rawHash: string,
): Promise<ItemMutationResult> {
  if (!rawHash) return { ok: false, error: "Missing item reference." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) {
    return { ok: false, error: "Not authorized." };
  }

  const { error } = await supabase.from("hidden_items").upsert(
    { user_id: user.id, raw_hash: rawHash },
    { onConflict: "user_id,raw_hash", ignoreDuplicates: true },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/** Unhide an item the current user previously hid (per-user; RLS-scoped). */
export async function unhideItemAction(
  rawHash: string,
): Promise<ItemMutationResult> {
  if (!rawHash) return { ok: false, error: "Missing item reference." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) {
    return { ok: false, error: "Not authorized." };
  }

  const { error } = await supabase
    .from("hidden_items")
    .delete()
    .eq("user_id", user.id)
    .eq("raw_hash", rawHash);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Default import: heuristic scrape then ingest. If the scrape/extraction fails,
 * the result is marked `recoverable` so the UI can offer the AI or paste
 * fallback. URL-validation and "already imported" failures are not recoverable.
 */
export async function importPostAction(url: string): Promise<ImportResult> {
  if (!url || !url.trim()) return { ok: false, error: "Enter a URL to import." };
  const unauth = await ensureAllowed();
  if (unauth) return { ok: false, error: unauth };

  try {
    assertPublicHttpUrl(url.trim());
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid URL." };
  }

  let article;
  try {
    article = await scrapeArticle(url.trim());
  } catch (err) {
    // Fetch / extraction failure: offer AI or paste.
    return {
      ok: false,
      recoverable: true,
      error: err instanceof Error ? err.message : "Could not read that page.",
    };
  }

  const result = await ingestArticle(article);
  if (result.ok) refreshDashboard();
  return result;
}

/** Fallback import: read the page with the LLM, then ingest. */
export async function importPostWithAIAction(url: string): Promise<ImportResult> {
  if (!url || !url.trim()) return { ok: false, error: "Enter a URL to import." };
  const unauth = await ensureAllowed();
  if (unauth) return { ok: false, error: unauth };
  try {
    assertPublicHttpUrl(url.trim());
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid URL." };
  }

  let result: ImportResult;
  try {
    result = await importBlogPostWithAI(url.trim());
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "AI could not read that page.",
    };
  }
  if (result.ok) refreshDashboard();
  return result;
}

/** Fallback import: ingest a pasted title + body. */
export async function importPostManualAction(
  url: string,
  title: string,
  body: string,
): Promise<ImportResult> {
  if (!url || !url.trim()) return { ok: false, error: "Enter a URL to import." };
  if (!title || !title.trim()) return { ok: false, error: "A title is required." };
  const unauth = await ensureAllowed();
  if (unauth) return { ok: false, error: unauth };
  try {
    assertPublicHttpUrl(url.trim());
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid URL." };
  }

  let result: ImportResult;
  try {
    result = await importPastedPost(url.trim(), title, body);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Import failed.",
    };
  }
  if (result.ok) refreshDashboard();
  return result;
}

/* --- Report full text ------------------------------------------------------ */

export type ReportTextResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/** Fetch a report URL server-side and return its article body as text, so the
 * details modal can render the full report even when the site blocks framing. */
export async function fetchReportTextAction(
  url: string,
): Promise<ReportTextResult> {
  if (!url || !url.trim()) return { ok: false, error: "No report URL." };
  const unauth = await ensureAllowed();
  if (unauth) return { ok: false, error: unauth };
  try {
    assertPublicHttpUrl(url.trim());
    const text = await fetchArticleText(url.trim());
    if (!text.trim()) return { ok: false, error: "No readable text found." };
    return { ok: true, text };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not fetch the report.",
    };
  }
}

/* --- Search ---------------------------------------------------------------- */

export type SearchReport = {
  id: string;
  title: string;
  url: string | null;
  description: string | null;
  source_name: string | null;
  published_at: string | null;
};
export type SearchBreach = {
  id: string;
  org_name: string;
  url: string | null;
  summary: string | null;
  source_name: string | null;
  event_date: string | null;
  event_date_label: string | null;
};
export type SearchVuln = {
  id: string;
  cve_id: string;
  target: string | null;
  url: string | null;
  detail: string | null;
  status: "confirmed" | "suspected" | "poc";
  source_name: string | null;
};
export type SearchResults = {
  query: string;
  reports: SearchReport[];
  breaches: SearchBreach[];
  vulns: SearchVuln[];
};

const SEARCH_LIMIT = 50;

/**
 * Search intel items, breaches, and vulnerabilities by keyword and return the
 * matches grouped by section. Honours the same relevance filter and per-user
 * hidden list as the dashboard; deleted items are already gone from the DB.
 */
export async function searchDashboard(query: string): Promise<SearchResults> {
  const q = (query ?? "").trim();
  const empty: SearchResults = { query: q, reports: [], breaches: [], vulns: [] };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) return empty;

  // Strip characters significant to PostgREST's or()/ilike grammar so the query
  // is a safe literal substring match.
  const safe = q.replace(/[,()%_\\*]/g, " ").replace(/\s+/g, " ").trim();
  if (safe.length < 2) return empty;
  const like = `%${safe}%`;

  const [intelRes, breachRes, vulnRes, hiddenRes] = await Promise.all([
    supabase
      .from("intel_items")
      .select("id, title, url, description, source_name, published_at, raw_hash")
      .or(`title.ilike.${like},description.ilike.${like}`)
      .order("published_at", { ascending: false })
      .limit(SEARCH_LIMIT),
    supabase
      .from("breaches")
      .select(
        "id, org_name, url, summary, source_name, event_date, event_date_label, raw_hash",
      )
      .or(`org_name.ilike.${like},summary.ilike.${like}`)
      .order("event_date", { ascending: false })
      .limit(SEARCH_LIMIT),
    supabase
      .from("vulnerabilities")
      .select("id, cve_id, target, url, detail, status, source_name, raw_hash")
      .or(`cve_id.ilike.${like},target.ilike.${like},detail.ilike.${like}`)
      .order("added_at", { ascending: false })
      .limit(SEARCH_LIMIT),
    supabase.from("hidden_items").select("raw_hash"),
  ]);

  const hidden = new Set((hiddenRes.data ?? []).map((r) => r.raw_hash));

  const reports: SearchReport[] = (intelRes.data ?? [])
    .filter((r) => !hidden.has(r.raw_hash) && isThreatIntel(r.title, r.description))
    .map((r) => ({
      id: r.id,
      title: r.title,
      url: r.url,
      description: r.description,
      source_name: r.source_name,
      published_at: r.published_at,
    }));
  const breaches: SearchBreach[] = (breachRes.data ?? [])
    .filter((b) => !hidden.has(b.raw_hash) && isThreatIntel(b.org_name, b.summary))
    .map((b) => ({
      id: b.id,
      org_name: b.org_name,
      url: b.url,
      summary: b.summary,
      source_name: b.source_name,
      event_date: b.event_date,
      event_date_label: b.event_date_label,
    }));
  const vulns: SearchVuln[] = (vulnRes.data ?? [])
    .filter((v) => !hidden.has(v.raw_hash))
    .map((v) => ({
      id: v.id,
      cve_id: v.cve_id,
      target: v.target,
      url: v.url,
      detail: v.detail,
      status: v.status,
      source_name: v.source_name,
    }));

  return { query: q, reports, breaches, vulns };
}
