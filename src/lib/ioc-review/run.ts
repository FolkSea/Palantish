import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { serverEnv } from "@/lib/env";
import { AnalystAgent } from "@/lib/agent/analyst";
import { fetchAllPages, fetchAllByIds } from "@/lib/supabase/paging";
import {
  selectCandidates,
  type ReviewCandidate,
} from "./candidates";

type Db = SupabaseClient<Database>;

// Once a day. The ingest cron is daily, but it is also run by hand and retried
// after a time budget, and none of those need a fresh opinion on the same
// corpus.
const MIN_HOURS_BETWEEN_RUNS = 20;

export type ReviewRunResult = {
  ran: boolean;
  /** Why it did not run, when it did not. */
  skipped?: string;
  candidates?: number;
  flagged?: number;
};

/**
 * The daily pass over indicators that join reports together.
 *
 * Writes flags for an administrator to act on and never deletes anything
 * itself: the cost of a wrong deletion is lost evidence, and the model is only
 * being asked for an opinion.
 */
export async function runIocReview(db: Db): Promise<ReviewRunResult> {
  const apiKey = serverEnv.anthropicApiKey;
  if (!apiKey) return { ran: false, skipped: "no ANTHROPIC_API_KEY" };

  const { data: last } = await db
    .from("ioc_review_runs")
    .select("ran_at")
    .order("ran_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last?.ran_at) {
    const hours = (Date.now() - new Date(last.ran_at).getTime()) / 3_600_000;
    if (hours < MIN_HOURS_BETWEEN_RUNS) {
      return { ran: false, skipped: `reviewed ${Math.round(hours)}h ago` };
    }
  }

  const candidates = await gatherCandidates(db);
  if (candidates.length === 0) {
    await db.from("ioc_review_runs").insert({ candidates: 0, flagged: 0 });
    return { ran: true, candidates: 0, flagged: 0 };
  }

  const agent = new AnalystAgent(apiKey);
  let verdicts;
  let model = "";
  try {
    const res = await agent.reviewIndicators(candidates);
    verdicts = res.verdicts;
    model = res.model;
  } catch (err) {
    // Recorded rather than thrown: a failed review must not fail the ingest, and
    // a run row with an error is how an administrator sees it stopped working.
    await db.from("ioc_review_runs").insert({
      candidates: candidates.length,
      flagged: 0,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ran: true, candidates: candidates.length, flagged: 0 };
  }

  const byValue = new Map(candidates.map((c) => [c.value, c]));
  const rows = verdicts
    .map((v) => {
      const c = byValue.get(v.value);
      if (!c) return null;
      return {
        ioc_id: c.iocId,
        value: c.value,
        ioc_type: c.iocType,
        category: v.category,
        reason: v.reason,
        reports: c.reports,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length > 0) {
    // ignoreDuplicates, not a merge: an open flag an administrator has already
    // read should not have its wording changed under them, and a resolved one
    // must not reopen. Values still worth flagging are re-offered once the
    // indicator itself is deleted and re-ingested.
    await db
      .from("ioc_review_flags")
      .upsert(rows, { onConflict: "ioc_id", ignoreDuplicates: true });
  }

  await db.from("ioc_review_runs").insert({
    candidates: candidates.length,
    flagged: rows.length,
    model,
  });
  return { ran: true, candidates: candidates.length, flagged: rows.length };
}

/**
 * Indicators worth reviewing: those referenced by more than one report, not
 * already allowlisted, and not already judged.
 */
async function gatherCandidates(db: Db): Promise<ReviewCandidate[]> {
  const links = await fetchAllPages<{ intel_item_id: string; ioc_id: string }>(
    (from, to) =>
      db
        .from("intel_item_iocs")
        .select("intel_item_id, ioc_id")
        // Both columns: ioc_id alone repeats, and range paging over a
        // non-unique sort can drop rows between pages.
        .order("ioc_id")
        .order("intel_item_id")
        .range(from, to),
  );

  const reportsByIoc = new Map<string, Set<string>>();
  for (const l of links) {
    const set = reportsByIoc.get(l.ioc_id);
    if (set) set.add(l.intel_item_id);
    else reportsByIoc.set(l.ioc_id, new Set([l.intel_item_id]));
  }
  const linking = [...reportsByIoc]
    .filter(([, items]) => items.size > 1)
    .map(([iocId, items]) => ({ iocId, reports: items.size }));
  if (linking.length === 0) return [];

  // Anything already judged - flagged and awaiting a decision, or judged
  // legitimate - is not worth asking about again.
  const { data: judged } = await db.from("ioc_review_flags").select("ioc_id");
  const seen = new Set((judged ?? []).map((r) => r.ioc_id));

  const rows = await fetchAllByIds<{ id: string; value: string; ioc_type: string }>(
    linking.map((l) => l.iocId).filter((id) => !seen.has(id)),
    (chunk, from, to) =>
      db
        .from("iocs")
        .select("id, value, ioc_type")
        .in("id", chunk)
        .order("id")
        .range(from, to),
  );

  const reportCount = new Map(linking.map((l) => [l.iocId, l.reports]));
  const allowed = await allowlistDomains(db);
  const candidates: ReviewCandidate[] = rows
    .filter((r) => !isAllowlisted(r.value, r.ioc_type, allowed))
    .map((r) => ({
      iocId: r.id,
      value: r.value,
      iocType: r.ioc_type,
      reports: reportCount.get(r.id) ?? 0,
    }));

  return selectCandidates(candidates);
}

async function allowlistDomains(db: Db): Promise<string[]> {
  const { data } = await db
    .from("ioc_allowlist")
    .select("value, ioc_type")
    .neq("ioc_type", "ip");
  return (data ?? []).map((r) => r.value.toLowerCase().trim()).filter(Boolean);
}

/** Suffix match, as everywhere else: an entry covers its subdomains. */
function isAllowlisted(
  value: string,
  iocType: string,
  allowed: string[],
): boolean {
  let host = value.toLowerCase();
  if (iocType === "uri") {
    try {
      host = new URL(value).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return false;
    }
  } else if (iocType !== "domain") {
    return false;
  }
  return allowed.some((a) => host === a || host.endsWith(`.${a}`));
}
