import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { notifyAllUsers } from "@/lib/notifications/create";
import { buildPocNotification } from "@/lib/notifications/run-messages";

type Db = SupabaseClient<Database>;

type InsertedItem = {
  id: string;
  raw_hash: string;
  kind: string;
  cve_id: string | null;
  exploit_status: string | null;
  target: string | null;
};

/**
 * Tell everyone about any newly ingested report carrying a released proof of
 * concept.
 *
 * Only "poc" qualifies: "confirmed" means exploitation is being seen in the
 * wild - already covered by the reporting itself - and "suspected" is not news
 * yet. Widening this would turn the bell into a feed of every vulnerability.
 */
export async function notifyPocReleases(
  db: Db,
  inserted: InsertedItem[],
): Promise<number> {
  const releases = inserted.filter(
    (i) => i.kind === "exploit" && i.exploit_status === "poc",
  );
  let sent = 0;
  for (const item of releases) {
    sent += await notifyAllUsers(
      db,
      buildPocNotification({
        itemId: item.id,
        rawHash: item.raw_hash,
        cveId: item.cve_id,
        headline: item.target,
      }),
    );
  }
  return sent;
}
