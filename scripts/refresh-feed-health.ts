/**
 * Populate per-feed freshness (sources.last_item_at / last_fetched_at /
 * last_error): `pnpm feeds:health`. Seeds from already-ingested content, then
 * does a live pull to refine. The ingest pipeline also maintains this.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { pullAllFeeds } = await import("@/lib/ingest/feeds");
  const { updateFeedHealth, seedLastItemFromStored } = await import(
    "@/lib/ingest/feed-health"
  );

  const db = createAdminClient();

  await seedLastItemFromStored(db);

  const { data: sources } = await db
    .from("sources")
    .select("name, feed_url, category, feed_type")
    .eq("active", true);
  const feedSources = (sources ?? [])
    .filter((s) => s.feed_url)
    .map((s) => ({
      name: s.name,
      feed_url: s.feed_url,
      category: s.category,
      feed_type: s.feed_type,
    }));

  const { health } = await pullAllFeeds(feedSources);
  await updateFeedHealth(db, health);

  const errored = health.filter((h) => h.error).length;
  console.log(
    `Refreshed ${feedSources.length} feeds (${errored} failed to fetch this run).`,
  );
  // Exit explicitly so keep-alive sockets do not keep the process running.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
