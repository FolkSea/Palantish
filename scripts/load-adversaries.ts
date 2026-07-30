/**
 * Load adversaries.json into the `adversaries` table.
 *
 *   pnpm load:adversaries                          # local dev (uses .env.local)
 *   pnpm load:adversaries <url> <service_role_key> # target a project directly
 *
 * The target is resolved as: CLI args, then NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY from the environment, then .env.local. Passing the
 * two args is the unambiguous way to target a remote (e.g. production) project.
 * Idempotent (upsert on cs_id).
 */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { RawAdversaryRecord } from "@/lib/ingest/adversaries";

const [argUrl, argKey] = process.argv.slice(2);
let SUPABASE_URL = argUrl || process.env.NEXT_PUBLIC_SUPABASE_URL;
let SERVICE_ROLE_KEY = argKey || process.env.SUPABASE_SERVICE_ROLE_KEY;

// Only touch .env.local when the target wasn't supplied via args or the
// environment - so a local .env.local can never shadow an explicit target.
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  config({ path: ".env.local" });
  SUPABASE_URL = SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  SERVICE_ROLE_KEY = SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(
      "Missing Supabase target. Pass them as args:\n" +
        "  pnpm load:adversaries <url> <service_role_key>\n" +
        "or set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.",
    );
    process.exit(1);
  }
  console.log(`Loading adversaries into ${SUPABASE_URL}`);

  const { mapAdversaryRecords } = await import("@/lib/ingest/adversaries");

  const raw = JSON.parse(
    readFileSync("adversaries.json", "utf8"),
  ) as RawAdversaryRecord[];

  const rows = mapAdversaryRecords(raw);

  const db = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Full replace: the JSON is the source of truth, so drop actors no longer in
  // it before loading the current set.
  const del = await db.from("adversaries").delete().not("id", "is", null);
  if (del.error) {
    console.error("Could not clear existing adversaries:", del.error.message);
    process.exit(1);
  }

  const { error, count } = await db
    .from("adversaries")
    .upsert(rows, { onConflict: "cs_id", count: "exact" });

  if (error) {
    console.error("Load failed:", error.message);
    process.exit(1);
  }
  console.log(`Loaded ${count ?? rows.length} adversaries.`);
  // Exit explicitly so keep-alive sockets do not keep the process running.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
