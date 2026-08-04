import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  matchSubscriptions,
  type NotifiableReport,
  type Subscription,
} from "./match";
import { notifyUsers } from "@/lib/notifications/create";
import { itemHref } from "@/lib/browse-links";

type Db = SupabaseClient<Database>;

export type NotifyTrigger = "ingest" | "labels" | "attribution";

/**
 * Load every subscription in the system. Small by nature - one row per user per
 * thing watched - and matching happens in memory so the label taxonomy rules
 * live in one tested place rather than in SQL.
 */
async function loadSubscriptions(db: Db): Promise<Subscription[]> {
  const { data } = await db.from("subscriptions").select("id, user_id, kind, value");
  return (data ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    value: r.value,
  }));
}

/** The subscribable facts about the given reports, read back from the database
 * so ingest and edit paths agree on what a report currently looks like. */
async function loadReports(db: Db, itemIds: string[]): Promise<NotifiableReport[]> {
  if (itemIds.length === 0) return [];
  const { data: items } = await db
    .from("intel_items")
    .select("id, country, adversary_label, crowdstrike_adversary")
    .in("id", itemIds);
  if (!items?.length) return [];

  const { data: labelRows } = await db
    .from("intel_item_labels")
    .select("intel_item_id, labels(name)")
    .in("intel_item_id", itemIds);
  const labels = new Map<string, string[]>();
  for (const row of labelRows ?? []) {
    const name = (row.labels as { name: string } | null)?.name;
    if (!name) continue;
    const arr = labels.get(row.intel_item_id);
    if (arr) arr.push(name);
    else labels.set(row.intel_item_id, [name]);
  }

  return items.map((i) => ({
    id: i.id,
    labels: labels.get(i.id) ?? [],
    adversaries: [i.adversary_label, i.crowdstrike_adversary],
    country: i.country,
  }));
}

/**
 * Queue a digest entry for every subscription these reports satisfy. Idempotent:
 * a user is owed a given report for a given reason once, so re-running ingest or
 * saving labels twice does not duplicate mail.
 *
 * Returns how many notifications were newly owed. Never throws - a notification
 * failure must not fail an ingest run or an analyst's edit.
 */
export async function queueNotifications(
  db: Db,
  itemIds: string[],
  trigger: NotifyTrigger,
): Promise<number> {
  try {
    const ids = [...new Set(itemIds)].filter(Boolean);
    if (ids.length === 0) return 0;

    const subscriptions = await loadSubscriptions(db);
    if (subscriptions.length === 0) return 0;

    const reports = await loadReports(db, ids);
    const rows = reports.flatMap((report) =>
      matchSubscriptions(report, subscriptions).map((m) => ({
        user_id: m.subscription.userId,
        intel_item_id: report.id,
        reason_kind: m.subscription.kind,
        reason_value: m.subscription.value,
        trigger,
      })),
    );
    if (rows.length === 0) return 0;

    // Drop what is already owed or already sent. The unique index is the real
    // guarantee; this just keeps a batch insert from failing on one collision.
    const { data: existing } = await db
      .from("notification_queue")
      .select("user_id, intel_item_id, reason_kind, reason_value")
      .in("intel_item_id", ids);
    const seen = new Set(
      (existing ?? []).map(
        (e) =>
          `${e.user_id}|${e.intel_item_id}|${e.reason_kind}|${e.reason_value.toLowerCase()}`,
      ),
    );
    const fresh = rows.filter((r) => {
      const key = `${r.user_id}|${r.intel_item_id}|${r.reason_kind}|${r.reason_value.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (fresh.length === 0) return 0;

    const { error } = await db.from("notification_queue").insert(fresh);
    if (error) return 0;

    // The same matches, delivered in the app as well as by email. Done here
    // because this is the one place matching happens, so the bell and the
    // digest can never disagree about what matched.
    await notifyMatches(db, fresh);
    return fresh.length;
  } catch {
    return 0;
  }
}

/**
 * Raise a bell notification per user per matched report.
 *
 * Deduped on the report, not the subscription: a report matching both a label
 * and a country is one thing that happened, and being told twice about it would
 * be noise. Failures are swallowed - an in-app notification is not worth
 * failing an ingest for, and the email digest is the durable channel.
 */
async function notifyMatches(
  db: Db,
  matches: { user_id: string; intel_item_id: string }[],
): Promise<void> {
  try {
    const itemIds = [...new Set(matches.map((m) => m.intel_item_id))];
    const { data: items } = await db
      .from("intel_items")
      .select("id, title, raw_hash")
      .in("id", itemIds);
    const byId = new Map((items ?? []).map((i) => [i.id, i]));

    const usersByItem = new Map<string, Set<string>>();
    for (const m of matches) {
      const set = usersByItem.get(m.intel_item_id);
      if (set) set.add(m.user_id);
      else usersByItem.set(m.intel_item_id, new Set([m.user_id]));
    }

    for (const [itemId, users] of usersByItem) {
      const item = byId.get(itemId);
      if (!item) continue;
      await notifyUsers(db, [...users], {
        kind: "subscription_match",
        title: item.title,
        body: "Matches one of your subscriptions",
        href: itemHref(item.raw_hash),
        dedupeKey: `subscription:${itemId}`,
      });
    }
  } catch {
    // Deliberately quiet: see the doc comment.
  }
}
