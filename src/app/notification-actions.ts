"use server";

import { getAuthenticatedClient } from "@/lib/auth";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Mark notifications read.
 *
 * Writes through the user's own RLS-scoped client, so the policy decides whose
 * rows these are - passing ids from the browser is safe because the database,
 * not this function, owns that question. No revalidatePath: the bell already
 * knows, and reloading every page to grey out a row would be absurd.
 */
export async function markNotificationsRead(ids: string[]): Promise<Result> {
  const auth = await getAuthenticatedClient();
  if (!auth) return { ok: false, error: "Not authorized." };
  if (ids.length === 0) return { ok: true };

  const { error } = await auth.supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids)
    .is("read_at", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Mark every unread notification read - the "clear the badge" action. */
export async function markAllNotificationsRead(): Promise<Result> {
  const auth = await getAuthenticatedClient();
  if (!auth) return { ok: false, error: "Not authorized." };

  const { error } = await auth.supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
