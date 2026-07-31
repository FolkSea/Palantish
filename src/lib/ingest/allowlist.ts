import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

/** Operator-configurable indicators that must never be scraped as IOCs. */
export type IocAllowlist = { domains: string[]; ips: string[] };

/**
 * Load the IOC allowlist (see the ioc_allowlist table). Domains are matched as
 * suffixes by the extractor (so a parent excludes its subdomains); IPs match
 * exactly. Failures degrade to an empty list so ingest never blocks on it.
 */
export async function loadIocAllowlist(db: Db): Promise<IocAllowlist> {
  const { data, error } = await db
    .from("ioc_allowlist")
    .select("value, ioc_type");
  if (error) return { domains: [], ips: [] };

  const domains: string[] = [];
  const ips: string[] = [];
  for (const r of data ?? []) {
    const v = r.value?.trim();
    if (!v) continue;
    if (r.ioc_type === "ip") ips.push(v);
    else domains.push(v.toLowerCase());
  }
  return { domains, ips };
}
