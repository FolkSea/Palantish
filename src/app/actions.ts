"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/env";
import { importBlogPost, type ImportResult } from "@/lib/ingest/import-post";

/**
 * Server action behind the "Import post" button. Auth-checked, then scrapes and
 * ingests the URL. On success it revalidates the dashboard so the new item and
 * any new source show up, but it does NOT regenerate the executive summary.
 */
export async function importPostAction(url: string): Promise<ImportResult> {
  if (!url || !url.trim()) return { ok: false, error: "Enter a URL to import." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) {
    return { ok: false, error: "Not authorized." };
  }

  let result: ImportResult;
  try {
    result = await importBlogPost(url.trim());
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Import failed.",
    };
  }

  if (result.ok) {
    // Refresh the dashboard (and settings source list) without touching the
    // cached executive summary.
    revalidatePath("/");
    revalidatePath("/settings");
  }
  return result;
}
