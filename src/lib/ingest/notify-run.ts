import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { notifyQuietly } from "@/lib/notifications/create";
import { buildRunNotifications } from "@/lib/notifications/run-messages";
// Staleness has its own window, independent of how much history the dashboard
// happens to show.
import { STALE_DAYS } from "@/lib/feed-status";

type Db = SupabaseClient<Database>;

export type RunSummary = {
  runId: string;
  scoped: boolean;
  added: number;
  summarised: boolean;
  flaggedIocs: number;
  errors: string[];
};

/**
 * Tell the administrators what a completed run did.
 *
 * Returns errors rather than throwing: this is the last thing an ingest does,
 * and nothing here is worth costing it its status.
 */
export async function notifyRunOutcome(
  db: Db,
  summary: RunSummary,
): Promise<string[]> {
  const notifications = buildRunNotifications({
    ...summary,
    staleFeeds: await staleFeedCount(db),
    staleDays: STALE_DAYS,
  });
  return notifyQuietly(db, notifications, "administrators");
}

/**
 * Active feeds with nothing recent, by the same rule the dashboard panel uses -
 * so the bell and the panel never disagree about what is stale.
 */
async function staleFeedCount(db: Db): Promise<number> {
  const cutoff = new Date(
    Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { count } = await db
    .from("sources")
    .select("id", { count: "exact", head: true })
    .eq("active", true)
    .not("feed_url", "is", null)
    .or(`last_item_at.is.null,last_item_at.lt.${cutoff}`);
  return count ?? 0;
}
