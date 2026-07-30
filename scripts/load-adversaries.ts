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

type RawAdversary = {
  ID?: string;
  name?: string;
  animal_classifier?: string | null;
  status?: string | null;
  description?: string | null;
  short_description?: string | null;
  first_seen?: string | null;
  last_seen?: string | null;
  objectives?: string[] | null;
  motivation?: string[] | null;
  targeting_profile?: string[] | null;
  community_identifiers?: string[] | null;
  internal_alternative_names?: string[] | null;
};

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

  const { deriveNexus, deriveMotivation, deriveCountry } = await import(
    "@/lib/ingest/adversaries"
  );

  const raw = JSON.parse(
    readFileSync("adversaries.json", "utf8"),
  ) as RawAdversary[];

  const rows = raw
    .filter((a) => a.name)
    .map((a) => ({
      cs_id: a.ID ?? null,
      name: a.name!,
      animal_classifier: a.animal_classifier ?? null,
      nexus: deriveNexus(a),
      // Classification stored directly on the actor (was actor_families).
      motivation: [deriveMotivation(a)],
      country: deriveCountry(a),
      status: a.status ?? null,
      description: a.description ?? null,
      short_description: a.short_description ?? null,
      first_seen: a.first_seen ?? null,
      last_seen: a.last_seen ?? null,
      objectives: a.objectives ?? null,
      targeting_profile: a.targeting_profile ?? null,
      community_identifiers: a.community_identifiers ?? null,
      internal_alternative_names: a.internal_alternative_names ?? null,
    }));

  const db = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
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
