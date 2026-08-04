import "server-only";

import { serverEnv } from "@/lib/env";

/**
 * Start an ingest run over HTTP, in the background.
 *
 * Chaining has to cross an invocation boundary: a run stops on its time budget
 * long before a backlog is drained, and the successor needs its own function
 * lifetime rather than the remainder of this one. The call resolves in
 * milliseconds because the receiver acknowledges and runs after responding.
 *
 * Shared so the cron chain and the "Refresh all Feeds" button behave the same.
 * They did not: the button called runIngest once, so a manual refresh did a
 * single pass and stopped, however much was left - which looked exactly like
 * the ingest making no progress.
 */
export async function triggerIngestRun(
  origin: string,
  chain = 0,
): Promise<void> {
  const url = new URL("/api/ingest", origin).toString();
  await fetch(url, {
    method: "POST",
    headers: {
      "x-ingest-secret": serverEnv.ingestCronSecret,
      "x-ingest-chain": String(chain),
      "x-ingest-background": "1",
    },
  });
}
