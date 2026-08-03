import "server-only";

import { getAuthenticatedClient } from "@/lib/auth";
import { fetchAllPages } from "@/lib/supabase/paging";
import { loadLabelsFor } from "@/lib/report-labels";
import {
  matchSubscriptions,
  type Subscription,
  type SubscriptionKind,
} from "@/lib/notify/match";
import type { SearchResultRow } from "@/app/actions";

// The window the feed considers, newest first. Same reasoning as the search
// corpus: matching happens in memory, so the set has to be bounded, and the page
// says so when there was more than it looked at.
export const FEED_LIMIT = 4000;
// Rows shown per section. The feed is a reading list, not an archive.
export const FEED_SECTION_LIMIT = 100;

const ITEM_COLS =
  "id, kind, title, url, description, source_name, published_at, raw_hash, " +
  "cve_id, target, exploit_status, date_label, country, confidence, " +
  "adversary_label, crowdstrike_adversary";

type FeedRow = {
  id: string;
  kind: string | null;
  title: string;
  url: string | null;
  description: string | null;
  source_name: string | null;
  published_at: string | null;
  raw_hash: string;
  cve_id: string | null;
  target: string | null;
  exploit_status: string | null;
  date_label: string | null;
  country: string | null;
  confidence: string | null;
  adversary_label: string | null;
  crowdstrike_adversary: string | null;
};

export type FeedSubscription = { kind: SubscriptionKind; value: string };

export type FeedResult = {
  /** What the user is following, for the header. */
  subscriptions: FeedSubscription[];
  reports: SearchResultRow[];
  breaches: SearchResultRow[];
  vulns: SearchResultRow[];
  /** True when more reports exist than the feed window covered. */
  truncated: boolean;
};

const EMPTY: FeedResult = {
  subscriptions: [],
  reports: [],
  breaches: [],
  vulns: [],
  truncated: false,
};

/**
 * The reports matching the signed-in user's subscriptions, newest first.
 *
 * Deliberately runs the same matcher as the notification queue, so the page and
 * the digest emails always agree on what "matches my subscriptions" means -
 * including that a label subscription covers its whole branch.
 *
 * The dashboard's relevance heuristic is deliberately not applied: it exists to
 * keep general news out of a bare keyword search, whereas a subscription is an
 * explicit statement of interest, so filtering would hide reports the user asked
 * to be told about.
 *
 * RLS-scoped: subscriptions are read through the user's own client, so this can
 * only ever see their own.
 */
export async function loadFeed(): Promise<FeedResult> {
  const auth = await getAuthenticatedClient();
  if (!auth) return EMPTY;
  const db = auth.supabase;

  const { data: subRows } = await db
    .from("subscriptions")
    .select("id, user_id, kind, value")
    .order("kind")
    .order("value");
  const subscriptions: Subscription[] = (subRows ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    value: r.value,
  }));
  const following = subscriptions.map((s) => ({ kind: s.kind, value: s.value }));
  if (subscriptions.length === 0) return { ...EMPTY, subscriptions: following };

  const [all, hiddenRows] = await Promise.all([
    fetchAllPages<FeedRow>((from, to) =>
      db
        .from("intel_items")
        .select(ITEM_COLS)
        .order("published_at", { ascending: false, nullsFirst: false })
        // Secondary key so paging cannot repeat or skip rows.
        .order("id")
        .range(from, Math.min(to, FEED_LIMIT)) as unknown as PromiseLike<{
        data: FeedRow[] | null;
      }>,
    ),
    fetchAllPages<{ raw_hash: string }>((from, to) =>
      db.from("hidden_items").select("raw_hash").order("raw_hash").range(from, to),
    ),
  ]);

  const truncated = all.length > FEED_LIMIT;
  const hidden = new Set(hiddenRows.map((r) => r.raw_hash));
  const rows = all.slice(0, FEED_LIMIT).filter((r) => !hidden.has(r.raw_hash));

  // Labels only matter when something is actually subscribed to one.
  const wantsLabels = subscriptions.some((s) => s.kind === "label");
  const labels = wantsLabels
    ? await loadLabelsFor(db, rows.map((r) => r.id))
    : new Map<string, string[]>();

  const matched = rows.filter(
    (r) =>
      matchSubscriptions(
        {
          id: r.id,
          labels: labels.get(r.id) ?? [],
          adversaries: [r.adversary_label, r.crowdstrike_adversary],
          country: r.country ?? null,
        },
        subscriptions,
      ).length > 0,
  );

  const pick = (kinds: string[]) =>
    matched.filter((r) => kinds.includes(r.kind ?? "")).slice(0, FEED_SECTION_LIMIT);
  const reportRows = pick(["research", "other"]);
  const breachRows = pick(["breach"]);
  const vulnRows = pick(["exploit"]);

  // Chips are only needed for the rows shown. When a label subscription drove
  // the matching the corpus map already has them; otherwise this is the only
  // label read, over a handful of rows.
  const shown = [...reportRows, ...breachRows, ...vulnRows];
  const chips = wantsLabels
    ? labels
    : await loadLabelsFor(db, shown.map((r) => r.id));
  const toRow = (r: FeedRow): SearchResultRow => ({
    id: r.id,
    title: r.title,
    url: r.url,
    description: r.description,
    source_name: r.source_name,
    published_at: r.published_at,
    country: r.country,
    confidence: r.confidence,
    adversary_label: r.adversary_label,
    crowdstrike_adversary: r.crowdstrike_adversary,
    raw_hash: r.raw_hash,
    labels: chips.get(r.id) ?? [],
  });

  return {
    subscriptions: following,
    reports: reportRows.map(toRow),
    breaches: breachRows.map(toRow),
    vulns: vulnRows.map(toRow),
    truncated,
  };
}
