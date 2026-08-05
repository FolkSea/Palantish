"use server";

import { ensureAuthenticated } from "@/lib/auth";
import { loadTimelineWindow, type TimelineData } from "@/lib/data";
import { normalizeTimelineDays } from "@/lib/timeline";

/**
 * The timeline over a longer window than the dashboard ships.
 *
 * The page carries the default range already, so this only runs when a reader
 * asks to look further back - which is why a year of history is an option at
 * all without every page load paying for one.
 *
 * `days` is normalised to one of the offered ranges rather than trusted: this
 * is a server action, so it is POST-invocable with any number at all, and an
 * unbounded window is a query over the whole corpus.
 */
export async function loadTimelineRangeAction(
  days: number,
): Promise<TimelineData> {
  const unauth = await ensureAuthenticated();
  if (unauth) return { events: [], streams: [] };
  return loadTimelineWindow(normalizeTimelineDays(days));
}
