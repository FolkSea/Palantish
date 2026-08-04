/**
 * Run the indicator review on demand, rather than waiting for the next ingest.
 *
 *   pnpm review:iocs            # respects the once-a-day guard
 *   pnpm review:iocs --force    # review again now
 *
 * Writes flags for an administrator to act on in Settings; deletes nothing.
 */
import { config } from "dotenv";
import { createAdminClient } from "@/lib/supabase/admin";
import { runIocReview } from "@/lib/ioc-review/run";

config({ path: ".env.local" });

const force = process.argv.slice(2).includes("--force");

async function main() {
  const db = createAdminClient();
  if (force) {
    // The guard reads the newest run row, so clearing today's is what "again"
    // means. The flags themselves are untouched.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await db.from("ioc_review_runs").delete().gte("ran_at", since);
  }
  const res = await runIocReview(db);
  if (!res.ran) {
    console.log(`Skipped: ${res.skipped}`);
    return;
  }
  console.log(`Reviewed ${res.candidates} indicators; flagged ${res.flagged}.`);
  if (res.flagged) console.log("Review them under Settings > Suspect IOCs.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
