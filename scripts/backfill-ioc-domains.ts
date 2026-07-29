/**
 * One-off cleanup: remove domain IOCs that are actually blog/source domains or
 * benign / registrar / DNS infrastructure - values that should never have been
 * stored as indicators. `pnpm backfill:iocs`. Idempotent.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { sourceDomain, shouldExcludeDomain } = await import(
    "@/lib/report-indicators"
  );
  const db = createAdminClient();

  async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from(table as never)
        .select(columns)
        .range(from, from + 999);
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...((data ?? []) as unknown as T[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  }

  // Every known blog/source domain (active and inactive).
  const sources = await fetchAll<{ url: string | null; feed_url: string | null }>(
    "sources",
    "url, feed_url",
  );
  const blogDomains = new Set<string>();
  for (const s of sources) {
    for (const d of [sourceDomain(s.url), sourceDomain(s.feed_url)]) {
      if (d) blogDomains.add(d);
    }
  }

  // Domain IOCs that should be excluded (blog/source/benign/infra).
  const iocs = await fetchAll<{ id: string; value: string; ioc_type: string }>(
    "iocs",
    "id, value, ioc_type",
  );
  const bogusIds = iocs
    .filter(
      (i) => i.ioc_type === "domain" && shouldExcludeDomain(i.value, blogDomains),
    )
    .map((i) => i.id);

  if (bogusIds.length === 0) {
    console.log("No bogus domain IOCs found.");
    process.exit(0);
  }

  // Unlink from all reports, then delete the now-orphaned IOC rows, in chunks.
  let unlinked = 0;
  for (let i = 0; i < bogusIds.length; i += 200) {
    const chunk = bogusIds.slice(i, i + 200);
    const del = await db.from("intel_item_iocs").delete().in("ioc_id", chunk).select("ioc_id");
    if (del.error) throw new Error(`unlink: ${del.error.message}`);
    unlinked += del.data?.length ?? 0;
    const delIoc = await db.from("iocs").delete().in("id", chunk);
    if (delIoc.error) throw new Error(`delete iocs: ${delIoc.error.message}`);
  }

  console.log(
    JSON.stringify(
      { bogusDomainIocs: bogusIds.length, linksRemoved: unlinked },
      null,
      2,
    ),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
