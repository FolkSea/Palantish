/**
 * Local ingestion runner: `pnpm ingest`.
 * Loads .env.local, runs the pipeline against the configured Supabase project,
 * and prints the result.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  // Import after env is loaded so server-only env reads succeed.
  const { runIngest } = await import("@/lib/ingest/pipeline");
  const result = await runIngest();
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "success") process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
