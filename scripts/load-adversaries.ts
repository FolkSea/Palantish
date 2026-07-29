/**
 * Load adversaries.json into the `adversaries` table: `pnpm load:adversaries`.
 * Idempotent (upsert on cs_id). Run after migrations, and again whenever
 * adversaries.json is refreshed.
 */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
config({ path: ".env.local" });

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
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { deriveNexus } = await import("@/lib/ingest/adversaries");

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
      status: a.status ?? null,
      description: a.description ?? null,
      short_description: a.short_description ?? null,
      first_seen: a.first_seen ?? null,
      last_seen: a.last_seen ?? null,
      objectives: a.objectives ?? null,
      motivation: a.motivation ?? null,
      targeting_profile: a.targeting_profile ?? null,
      community_identifiers: a.community_identifiers ?? null,
      internal_alternative_names: a.internal_alternative_names ?? null,
    }));

  const db = createAdminClient();
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
