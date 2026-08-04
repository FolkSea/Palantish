/**
 * Remove already-stored IOC rows that the allowlist / non-routable rules now
 * exclude - vendor & press domains, loopback / private IPs, public-DNS noise.
 * Deleting an iocs row cascades its intel_item_iocs links.
 *
 *   pnpm prune-iocs                          # local dev (uses .env.local), dry run
 *   pnpm prune-iocs --apply                  # write deletions
 *   pnpm prune-iocs <url> <service_role_key> # target a project directly
 *
 * Domains match as suffixes (a parent removes its subdomains); URI rows are
 * judged by their host; IP rows by the non-routable ranges + allowlisted IPs.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  shouldExcludeDomain,
  shouldExcludeIp,
  isFilenameOrCode,
} from "@/lib/report-indicators";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const positional = args.filter((a) => !a.startsWith("--"));
const [argUrl, argKey] = positional;

// An unset shell variable expands to an empty argument, so `prune-iocs
// "$PROD_URL" "$PROD_KEY"` with those unset used to fall quietly back to
// .env.local and prune the LOCAL database instead - reporting a clean result
// for a database nobody asked about. Meaning to target a project and missing is
// an error, not a reason to pick a different one.
if (positional.length > 0 && (!argUrl || !argKey)) {
  console.error(
    "A target was given but is incomplete - check the variables are set.\n" +
      `  url: ${argUrl ? argUrl : "(empty)"}\n` +
      `  key: ${argKey ? "(provided)" : "(empty)"}\n` +
      "Pass both, or pass neither to use .env.local.",
  );
  process.exit(1);
}

let SUPABASE_URL = argUrl || process.env.NEXT_PUBLIC_SUPABASE_URL;
let SERVICE_ROLE_KEY = argKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  config({ path: ".env.local" });
  SUPABASE_URL = SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  SERVICE_ROLE_KEY = SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function hostOf(uri: string): string {
  try {
    return new URL(uri).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(
      "Missing Supabase target. Pass <url> <service_role_key> or set " +
        "NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.",
    );
    process.exit(1);
  }
  const db = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Always say which database this is about to read. A prune reporting "0 rows"
  // is only good news if it ran against the project you meant.
  const local = /localhost|127\.0\.0\.1/.test(SUPABASE_URL);
  console.log(`Target: ${SUPABASE_URL}${local ? "  (LOCAL)" : ""}\n`);

  const { data: allow, error: allowErr } = await db
    .from("ioc_allowlist")
    .select("value, ioc_type");
  if (allowErr) throw new Error(allowErr.message);
  const allowDomains = (allow ?? [])
    .filter((r) => r.ioc_type !== "ip")
    .map((r) => r.value.toLowerCase().trim());
  const allowIps = (allow ?? [])
    .filter((r) => r.ioc_type === "ip")
    .map((r) => r.value.trim());

  // Page through every IOC row (PostgREST caps a single response at 1000).
  const iocs: { id: string; value: string; ioc_type: string }[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("iocs")
      .select("id, value, ioc_type")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    iocs.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  const doomed: { id: string; value: string; ioc_type: string }[] = [];
  for (const i of iocs ?? []) {
    if (i.ioc_type === "domain") {
      // Filenames and code identifiers stored as domains (sharer.php,
      // index.html, console.log) - never IOCs, whichever path wrote them.
      if (isFilenameOrCode(i.value)) doomed.push(i);
      else if (shouldExcludeDomain(i.value.toLowerCase(), allowDomains))
        doomed.push(i);
    } else if (i.ioc_type === "uri") {
      const host = hostOf(i.value);
      if (host && shouldExcludeDomain(host, allowDomains)) doomed.push(i);
    } else if (i.ioc_type === "ip") {
      if (shouldExcludeIp(i.value, allowIps)) doomed.push(i);
    }
  }

  const byType = new Map<string, number>();
  for (const d of doomed) byType.set(d.ioc_type, (byType.get(d.ioc_type) ?? 0) + 1);
  console.log(
    `Scanned ${iocs?.length ?? 0} IOCs; ${doomed.length} match the allowlist:`,
  );
  for (const [t, n] of [...byType].sort()) console.log(`  ${t}: ${n}`);
  for (const d of doomed.slice(0, 40))
    console.log(`  - [${d.ioc_type}] ${d.value}`);
  if (doomed.length > 40) console.log(`  ... and ${doomed.length - 40} more`);

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to delete these IOC rows.");
    return;
  }

  let deleted = 0;
  const ids = doomed.map((d) => d.id);
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { error: delErr } = await db.from("iocs").delete().in("id", chunk);
    if (delErr) throw new Error(delErr.message);
    deleted += chunk.length;
  }
  console.log(`\nDeleted ${deleted} IOC rows (their report links cascaded).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
