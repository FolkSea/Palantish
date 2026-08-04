import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

export type NotificationKind =
  | "subscription_match"
  | "feeds_ingested"
  | "feed_ingested"
  | "summary_updated"
  | "stale_feeds"
  | "suspect_iocs"
  | "ingest_errors"
  | "new_user";

export type NewNotification = {
  kind: NotificationKind;
  title: string;
  body?: string | null;
  /** Where clicking it goes. Omit for something with nowhere to send anyone. */
  href?: string | null;
  /**
   * Identifies the event, not the notification. Two runs of the same ingest, or
   * a user signing in twice, must collapse to one row - so this carries the run
   * id, the day, or the subject's id rather than anything time-varying.
   */
  dedupeKey: string;
};

/**
 * Deliver to specific users. Silently does nothing on conflict: the dedupe key
 * has already decided this event was delivered, and a retry saying so again is
 * the normal case rather than an error.
 */
export async function notifyUsers(
  db: Db,
  userIds: string[],
  notification: NewNotification,
): Promise<number> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return 0;
  const rows = ids.map((user_id) => ({
    user_id,
    kind: notification.kind,
    title: notification.title,
    body: notification.body ?? null,
    href: notification.href ?? null,
    dedupe_key: notification.dedupeKey,
  }));
  const { data, error } = await db
    .from("notifications")
    .upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/** Every administrator. Operational news has no other audience. */
export async function notifyAdministrators(
  db: Db,
  notification: NewNotification,
): Promise<number> {
  const { data } = await db
    .from("account_roles")
    .select("user_id")
    .eq("role", "administrator");
  return notifyUsers(db, (data ?? []).map((r) => r.user_id), notification);
}

/**
 * Deliver several notifications, never letting one failure lose the rest.
 *
 * These are called from the end of an ingest, where the house rule is that
 * post-processing is non-fatal: a notification that cannot be written must not
 * cost the run its summary or its status.
 */
export async function notifyQuietly(
  db: Db,
  notifications: NewNotification[],
  audience: "administrators",
): Promise<string[]> {
  const errors: string[] = [];
  for (const n of notifications) {
    try {
      if (audience === "administrators") await notifyAdministrators(db, n);
    } catch (err) {
      errors.push(
        `notify ${n.kind}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return errors;
}
