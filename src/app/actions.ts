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
import { scrapeArticle, assertPublicHttpUrl } from "@/lib/ingest/scrape";

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
  // Keep url/title for the blocklist record, then remove the row.
  const { data: row } = await db
    .from("intel_items")
    .select("url, title")
    .eq("raw_hash", rawHash)
    .maybeSingle();
  const { error: delErr } = await db
    .from("intel_items")
    .delete()
    .eq("raw_hash", rawHash);
  if (delErr) return { ok: false, error: delErr.message };

  const { error: blockErr } = await db.from("deleted_items").upsert(
    {
      raw_hash: rawHash,
      url: row?.url ?? null,
      title: row?.title ?? null,
      deleted_by: user.id,
    },
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
