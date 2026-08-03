"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedClient } from "@/lib/auth";

export type BookmarkResult =
  | { ok: true; bookmarked: boolean }
  | { ok: false; error: string };

/**
 * Add or remove a report from the signed-in user's reading list. Written through
 * the user's own RLS-scoped client, so a user can only ever change their own.
 *
 * Takes the desired state rather than flipping what it finds, so a double-click
 * or a stale button cannot leave the list in the opposite state to the icon.
 */
export async function setBookmarkAction(
  intelItemId: string,
  bookmarked: boolean,
): Promise<BookmarkResult> {
  if (!intelItemId) return { ok: false, error: "Missing report reference." };
  const auth = await getAuthenticatedClient();
  if (!auth) return { ok: false, error: "Not authorized." };
  const { supabase, user } = auth;

  if (bookmarked) {
    const { error } = await supabase
      .from("bookmarks")
      .upsert(
        { user_id: user.id, intel_item_id: intelItemId },
        { onConflict: "user_id,intel_item_id", ignoreDuplicates: true },
      );
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase
      .from("bookmarks")
      .delete()
      .eq("user_id", user.id)
      .eq("intel_item_id", intelItemId);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/reading-list");
  return { ok: true, bookmarked };
}

/** Whether the signed-in user has this report on their reading list. */
export async function isBookmarked(intelItemId: string): Promise<boolean> {
  const auth = await getAuthenticatedClient();
  if (!auth || !intelItemId) return false;
  const { data } = await auth.supabase
    .from("bookmarks")
    .select("intel_item_id")
    .eq("intel_item_id", intelItemId)
    .maybeSingle();
  return !!data;
}
