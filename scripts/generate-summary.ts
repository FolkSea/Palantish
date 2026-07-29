/**
 * Generate + store the executive summary now: `pnpm summary`.
 * Uses Anthropic when ANTHROPIC_API_KEY is set, otherwise the rules fallback.
 * The ingest pipeline also runs this on every refresh.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { generateAndStoreSummary } = await import("@/lib/summary/generate");

  const db = createAdminClient();
  const result = await generateAndStoreSummary(db);
  console.log(`source=${result.source} model=${result.model ?? "-"}`);
  console.log("---");
  console.log(result.summary);
  // Exit explicitly so keep-alive sockets do not keep the process running.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
