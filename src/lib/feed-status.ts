// How a feed is doing, as opposed to whether it is switched on.
//
// "Active" is the operator's toggle; it says nothing about whether anything is
// coming through. A feed can be active and silent for a month, which is exactly
// the case the dashboard warns about and the feed list used to hide.
//
// Pure, and the single definition: the stale-feed warning, the notification and
// the feeds list all read it, so they cannot disagree about what stale means.

/** Matches the dashboard's stale window (TIMELINE_DAYS). */
export const STALE_DAYS = 30;

export type FeedHealth = "off" | "error" | "never" | "stale" | "ok";

export type FeedStatusInput = {
  active: boolean;
  /** Null for a manual source with nothing to fetch. */
  feedUrl: string | null;
  lastItemAt: string | null;
  lastFetchedAt?: string | null;
  lastError?: string | null;
};

/**
 * The order matters: a switched-off feed is not a fault, and a fetch error
 * explains a silence better than the silence itself does.
 */
export function feedHealth(
  s: FeedStatusInput,
  now: number = Date.now(),
): FeedHealth {
  if (!s.active) return "off";
  // Nothing to fetch, so nothing can be stale about it.
  if (!s.feedUrl) return "ok";
  if (s.lastError) return "error";
  if (!s.lastItemAt) return "never";
  const age = now - new Date(s.lastItemAt).getTime();
  if (!Number.isFinite(age)) return "never";
  return age > STALE_DAYS * 24 * 60 * 60 * 1000 ? "stale" : "ok";
}

export const FEED_HEALTH_LABEL: Record<FeedHealth, string> = {
  off: "Off",
  error: "Error",
  never: "No items yet",
  stale: "Stale",
  ok: "Active",
};

/** True for the states the dashboard counts as needing attention. */
export function needsAttention(h: FeedHealth): boolean {
  return h === "error" || h === "never" || h === "stale";
}
