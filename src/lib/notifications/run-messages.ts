// What an administrator is told about a completed ingest run.
//
// Pure - no database, no server imports - so the wording, the counts and the
// dedupe keys are unit-tested directly. Delivery and the stale-feed count live
// in the server module that calls this.

import type { NewNotification } from "./create";

export type RunOutcome = {
  runId: string;
  /** A single-feed update rather than a full pull. */
  scoped: boolean;
  added: number;
  summarised: boolean;
  flaggedIocs: number;
  errors: string[];
  /** Active feeds with nothing recent, counted by the caller. */
  staleFeeds: number;
  /** Window the stale rule uses, for the wording. */
  staleDays: number;
};

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Every notification is keyed on the run id, so the chained runs a large
 * backlog produces do not each announce themselves, and a retry says nothing
 * new.
 */
export function buildRunNotifications(outcome: RunOutcome): NewNotification[] {
  const {
    runId,
    scoped,
    added,
    summarised,
    flaggedIocs,
    errors,
    staleFeeds,
    staleDays,
  } = outcome;
  const out: NewNotification[] = [];

  const count =
    added > 0 ? `${plural(added, "new report")} added` : "No new reports";
  out.push(
    scoped
      ? {
          kind: "feed_ingested",
          title: "Feed updated",
          body: count,
          href: "/",
          dedupeKey: `feed_ingested:${runId}`,
        }
      : {
          kind: "feeds_ingested",
          title: "All feeds ingested",
          body: count,
          href: "/",
          dedupeKey: `feeds_ingested:${runId}`,
        },
  );

  if (summarised) {
    out.push({
      kind: "summary_updated",
      title: "Executive summary updated",
      body: "The dashboard summary has been regenerated.",
      href: "/",
      dedupeKey: `summary_updated:${runId}`,
    });
  }

  if (flaggedIocs > 0) {
    out.push({
      kind: "suspect_iocs",
      // A count, not one per indicator: a run flagging forty would otherwise
      // bury everything else in the bell.
      title: `${plural(flaggedIocs, "suspect indicator")} to review`,
      body: "The daily check found indicators that may not be real.",
      href: "/settings",
      dedupeKey: `suspect_iocs:${runId}`,
    });
  }

  if (errors.length > 0) {
    out.push({
      kind: "ingest_errors",
      title: `Ingest finished with ${plural(errors.length, "error")}`,
      // The first is the one usually worth seeing; the rest are in the run log.
      body: errors[0]?.slice(0, 160) ?? null,
      href: "/settings",
      dedupeKey: `ingest_errors:${runId}`,
    });
  }

  if (staleFeeds > 0) {
    out.push({
      kind: "stale_feeds",
      title: `${plural(staleFeeds, "feed")} look stale`,
      body: `No items in the last ${staleDays} days, or failing to fetch.`,
      href: "/settings",
      dedupeKey: `stale_feeds:${runId}`,
    });
  }

  return out;
}
