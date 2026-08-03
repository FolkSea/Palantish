import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { serverEnv } from "@/lib/env";
import { itemHref } from "@/lib/browse-links";
import { renderDigest, type DigestEntry } from "./digest";
import { emailConfigured, sendEmail } from "./send";

type Db = SupabaseClient<Database>;

// One run's worth of mail. Far above any realistic backlog, but bounded so a
// runaway queue cannot turn one dispatch into an unbounded send.
const MAX_ROWS_PER_RUN = 2000;

export type DispatchResult = {
  sent: number;
  recipients: number;
  skipped: boolean;
  errors: string[];
};

type PendingRow = {
  id: string;
  user_id: string;
  reason_kind: DigestEntry["reasonKind"];
  reason_value: string;
  trigger: string;
  intel_items: {
    title: string;
    url: string | null;
    source_name: string | null;
    published_at: string | null;
    raw_hash: string;
  } | null;
};

function toEntry(row: PendingRow): DigestEntry | null {
  const item = row.intel_items;
  if (!item) return null;
  const trigger: DigestEntry["trigger"] =
    row.trigger === "labels" || row.trigger === "attribution" ? row.trigger : "ingest";
  const href = itemHref(item.raw_hash);
  return {
    reasonKind: row.reason_kind,
    reasonValue: row.reason_value,
    trigger,
    title: item.title,
    url: item.url,
    sourceName: item.source_name,
    publishedAt: item.published_at,
    itemUrl: href === "/" ? null : `${serverEnv.appUrl}${href}`,
  };
}

/**
 * Send everything owed, one digest per subscriber. Rows are only marked sent
 * once their mail is accepted, so a provider outage leaves the backlog intact
 * for the next run rather than silently discarding notifications.
 *
 * When mail is not configured the queue is left alone and `skipped` is true:
 * configuring it later still delivers what was owed while it was down.
 */
export async function dispatchNotifications(db: Db): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, recipients: 0, skipped: false, errors: [] };
  if (!emailConfigured()) {
    result.skipped = true;
    return result;
  }

  const { data, error } = await db
    .from("notification_queue")
    .select(
      "id, user_id, reason_kind, reason_value, trigger, " +
        "intel_items(title, url, source_name, published_at, raw_hash)",
    )
    .is("sent_at", null)
    .order("created_at", { ascending: true })
    .limit(MAX_ROWS_PER_RUN);
  if (error) {
    result.errors.push(`queue read: ${error.message}`);
    return result;
  }
  const pending = (data ?? []) as unknown as PendingRow[];
  if (pending.length === 0) return result;

  const byUser = new Map<string, PendingRow[]>();
  for (const row of pending) {
    const arr = byUser.get(row.user_id);
    if (arr) arr.push(row);
    else byUser.set(row.user_id, [row]);
  }

  for (const [userId, rows] of byUser) {
    const { data: userData } = await db.auth.admin.getUserById(userId);
    const to = userData?.user?.email;
    if (!to) {
      // No address to send to; drop the rows rather than retrying forever.
      await markSent(db, rows, "no email address on the account");
      result.errors.push(`user ${userId}: no email address`);
      continue;
    }

    const entries = rows.map(toEntry).filter((e): e is DigestEntry => e !== null);
    const digest = renderDigest(entries, serverEnv.appUrl);
    if (!digest) continue;

    const sendResult = await sendEmail({
      to,
      subject: digest.subject,
      text: digest.text,
      html: digest.html,
    });
    if (sendResult.ok) {
      await markSent(db, rows, null);
      result.sent += rows.length;
      result.recipients += 1;
    } else {
      // Left unsent so the next run retries; the reason is recorded so a stuck
      // queue is diagnosable instead of merely quiet.
      await db
        .from("notification_queue")
        .update({ last_error: sendResult.error.slice(0, 500) })
        .in(
          "id",
          rows.map((r) => r.id),
        );
      result.errors.push(`send to ${userId}: ${sendResult.error}`);
    }
  }
  return result;
}

async function markSent(db: Db, rows: PendingRow[], note: string | null) {
  await db
    .from("notification_queue")
    .update({ sent_at: new Date().toISOString(), last_error: note })
    .in(
      "id",
      rows.map((r) => r.id),
    );
}
