import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { FeedHealth } from "./feeds";

type Db = SupabaseClient<Database>;

function isoOrNull(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/**
 * Record the result of a feed pull on the sources table. On success we advance
 * last_item_at (never regress it) and clear last_error; on failure we set
 * last_error but leave last_item_at untouched so a transient fetch failure does
 * not make a healthy feed look stale.
 */
export async function updateFeedHealth(db: Db, health: FeedHealth[]): Promise<void> {
  const { data: sources } = await db
    .from("sources")
    .select("name, last_item_at");
  const existing = new Map(
    (sources ?? []).map((s) => [s.name, s.last_item_at]),
  );

  await Promise.all(
    health.map(async (h) => {
      if (!existing.has(h.name)) return;
      if (h.error) {
        const last_error = h.error.replace(/\s+/g, " ").slice(0, 200);
        await db.from("sources").update({ last_error }).eq("name", h.name);
        return;
      }
      const prev = existing.get(h.name) ?? null;
      const latest = isoOrNull(h.latestItemAt);
      const last_item_at =
        latest && (!prev || latest > prev) ? latest : prev;
      await db
        .from("sources")
        .update({
          last_item_at,
          last_fetched_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("name", h.name);
    }),
  );
}

/**
 * Seed last_item_at from already-ingested content (max published date per
 * source across all reports). Gives an accurate lower bound even for feeds that
 * currently fail to fetch.
 */
export async function seedLastItemFromStored(db: Db): Promise<void> {
  const [{ data: intel }, { data: sources }] = await Promise.all([
    db.from("intel_items").select("source_name, published_at"),
    db.from("sources").select("name, last_item_at"),
  ]);

  const maxByName = new Map<string, string>();
  const consider = (name: string | null, date: string | null) => {
    if (!name || !date) return;
    const cur = maxByName.get(name);
    if (!cur || date > cur) maxByName.set(name, date);
  };
  for (const r of intel ?? []) consider(r.source_name, r.published_at);

  await Promise.all(
    (sources ?? []).map(async (s) => {
      const stored = maxByName.get(s.name);
      if (!stored) return;
      const prev = s.last_item_at;
      // Compare as dates; stored is a YYYY-MM-DD date, prev an ISO timestamp.
      if (prev && new Date(prev) >= new Date(`${stored}T23:59:59Z`)) return;
      await db
        .from("sources")
        .update({ last_item_at: new Date(`${stored}T12:00:00Z`).toISOString() })
        .eq("name", s.name);
    }),
  );
}
