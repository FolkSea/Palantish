import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { Indicators } from "@/lib/report-indicators";

type Db = SupabaseClient<Database>;

export type IocRow = { value: string; ioc_type: string };

/** IOC rows for the IP / domain / URI / file-hash indicators in a set. */
export function indicatorRows(indicators: Indicators): IocRow[] {
  return [
    ...indicators.ips.map((value) => ({ value, ioc_type: "ip" })),
    ...indicators.domains.map((value) => ({ value, ioc_type: "domain" })),
    ...indicators.uris.map((value) => ({ value, ioc_type: "uri" })),
    ...indicators.files.map((value) => ({ value, ioc_type: "file_hash" })),
    ...indicators.cves.map((value) => ({ value, ioc_type: "cve" })),
  ].filter((r) => r.value.trim().length > 0);
}

/**
 * Upsert IOC rows (deduped by value; onConflict does not touch `comment`, so an
 * existing value keeps any comment set on it) and link them to an intel item.
 * Returns the number of links written. Shared by ingest and the report modal.
 */
export async function linkIocsToItem(
  db: Db,
  intelItemId: string,
  rows: IocRow[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const upserted = await db
    .from("iocs")
    .upsert(rows, { onConflict: "value" })
    .select("id, value");
  if (upserted.error) throw new Error(upserted.error.message);

  const links = (upserted.data ?? []).map((ioc) => ({
    intel_item_id: intelItemId,
    ioc_id: ioc.id,
  }));
  const { error } = await db
    .from("intel_item_iocs")
    .upsert(links, { onConflict: "intel_item_id,ioc_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);

  return links.length;
}
