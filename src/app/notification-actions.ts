"use server";

import { getAuthenticatedClient } from "@/lib/auth";
import type { NotificationItem } from "@/lib/notifications/read";

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

/**
 * Anything newer than `since`, plus the current unread count.
 *
 * Polled rather than pushed. Supabase Realtime would be the obvious choice, but
 * realtime is switched off in this project's local Supabase (the full stack
 * OOM-kills the dev machine), so it could not be exercised before shipping -
 * and a minute-granular poll of one small indexed query is cheap enough that
 * the difference is not worth an unverifiable dependency.
 */
export async function pollNotifications(
  sinceIso: string,
): Promise<{ items: NotificationItem[]; unread: number }> {
  const auth = await getAuthenticatedClient();
  if (!auth) return { items: [], unread: 0 };

  const { data } = await auth.supabase
    .from("notifications")
    .select("id, kind, title, body, href, created_at, read_at")
    .gt("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(20);

  const { count } = await auth.supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  return {
    items: (data ?? []).map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      href: n.href,
      createdAt: n.created_at,
      read: n.read_at !== null,
    })),
    unread: count ?? 0,
  };
}
