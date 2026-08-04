"use server";

import { getAdministratorClient } from "@/lib/auth";
import { fetchAllPages } from "@/lib/supabase/paging";
import { summariseDropReasons, type DropBreakdown } from "@/lib/drop-reasons";

export type DropSummaryResult =
  | { ok: true; total: number; breakdown: DropBreakdown[] }
  | { ok: false; error: string };

/**
 * Why one feed's candidates were dropped, grouped for the chart.
 *
 * Counts distinct candidates, which is NOT the same as the feed's posts_dropped
 * tally and should not be presented as if it were. dropped_items upserts on
 * raw_hash, so a candidate dropped again next run stores one row; posts_dropped
 * is bumped every run, so it counts that candidate twice. Locally Apple Security
 * Releases reads 80 against 40 stored rows, and Check Point 13 against 14 - the
 * counter can also lag when a run records the drop but fails to bump the stat.
 * The popup says which number it is showing.
 */
export async function dropSummaryForSource(
  sourceName: string,
): Promise<DropSummaryResult> {
  const auth = await getAdministratorClient();
  if (!auth) return { ok: false, error: "Administrator access required." };
  if (!sourceName) return { ok: false, error: "Missing feed." };

  const rows = await fetchAllPages<{ reason: string | null }>((from, to) =>
    auth.supabase
      .from("dropped_items")
      .select("reason, raw_hash")
      .eq("source_name", sourceName)
      .order("raw_hash")
      .range(from, to),
  );

  return {
    ok: true,
    total: rows.length,
    breakdown: summariseDropReasons(rows.map((r) => r.reason)),
  };
}
