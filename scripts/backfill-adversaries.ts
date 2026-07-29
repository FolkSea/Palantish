/**
 * Re-classify existing intel_items using the adversaries catalogue:
 * `pnpm backfill:adversaries`. Matches adversary aliases in each item's
 * title/description and sets crowdstrike_adversary, actor_id (nexus), and
 * promotes report/breaking items attributed to a nation-state to
 * actor_activity - so the 30-day timeline and actor cards fill out.
 * Idempotent.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import type { Database } from "@/lib/supabase/database.types";

type IntelUpdate = Database["public"]["Tables"]["intel_items"]["Update"];

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { buildGroupsFromAdversaries } = await import("@/lib/ingest/adversaries");
  const { sortGroups, matchGroup } = await import("@/lib/ingest/enrich/rules");

  const db = createAdminClient();

  const [{ data: adversaries }, { data: actors }, { data: items }] =
    await Promise.all([
      db
        .from("adversaries")
        .select(
          "name, animal_classifier, description, short_description, motivation, community_identifiers, internal_alternative_names",
        ),
      db.from("actors").select("id, nexus"),
      db.from("intel_items").select("id, title, description, item_type, actor_id, crowdstrike_adversary"),
    ]);

  const groups = sortGroups(buildGroupsFromAdversaries(adversaries ?? []));
  const actorIdByNexus = new Map((actors ?? []).map((a) => [a.nexus, a.id]));

  let matched = 0;
  let updated = 0;

  for (const item of items ?? []) {
    const hay = `${item.title} ${item.description ?? ""}`.toLowerCase();
    const group = matchGroup(hay, groups);
    if (!group) continue;
    matched++;

    const patch: IntelUpdate = {};
    if (item.crowdstrike_adversary !== group.cs) patch.crowdstrike_adversary = group.cs;

    const actorId = actorIdByNexus.get(group.nexus) ?? null;
    if (actorId && item.actor_id !== actorId) patch.actor_id = actorId;

    // Promote nation-state-attributed reporting to actor activity.
    const nationState = group.nexus !== "other";
    if (
      nationState &&
      (item.item_type === "report" || item.item_type === "breaking")
    ) {
      patch.item_type = "actor_activity";
    }

    if (Object.keys(patch).length === 0) continue;
    const { error } = await db.from("intel_items").update(patch).eq("id", item.id);
    if (error) console.error(`update ${item.id} failed:`, error.message);
    else updated++;
  }

  console.log(
    JSON.stringify(
      { scanned: items?.length ?? 0, matched, updated }, null, 2,
    ),
  );
  // Exit explicitly so keep-alive sockets do not keep the process running.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
