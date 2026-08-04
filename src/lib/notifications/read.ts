import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

export type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  createdAt: string;
  read: boolean;
};

// The bell shows a recent window, not a history. Older than this and it is
// something to look up rather than be told about.
const BELL_LIMIT = 30;

/**
 * The signed-in user's notifications, newest first, with the unread count.
 *
 * Read through the caller's RLS-scoped client, so the policy is what decides
 * whose notifications these are - not a filter that could be forgotten.
 */
export async function loadNotifications(
  db: Db,
): Promise<{ items: NotificationItem[]; unread: number }> {
  const { data, error } = await db
    .from("notifications")
    .select("id, kind, title, body, href, created_at, read_at")
    .order("created_at", { ascending: false })
    .limit(BELL_LIMIT);
  if (error) return { items: [], unread: 0 };

  const items = (data ?? []).map((n) => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    href: n.href,
    createdAt: n.created_at,
    read: n.read_at !== null,
  }));

  // Counted over the whole table rather than the window above: a badge that
  // stops at 30 unread would quietly understate the backlog.
  const { count } = await db
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  return { items, unread: count ?? 0 };
}
