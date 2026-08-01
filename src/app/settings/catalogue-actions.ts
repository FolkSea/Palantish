"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureAuthenticated } from "@/lib/auth";
import { toAscii } from "@/lib/text";
import {
  MOTIVATIONS,
  type ActorInput,
  type ActorRecord,
  type ActorResult,
  type Motivation,
} from "@/lib/actor-catalogue";
import type { Nexus } from "@/lib/badges";
import { buildGroupsFromAdversaries } from "@/lib/ingest/adversaries";
import { sortGroups, matchGroup } from "@/lib/ingest/enrich/rules";

function toList(csv: string): string[] {
  return csv
    .split(",")
    .map((s) => toAscii(s).trim())
    .filter(Boolean);
}

const ACTOR_SELECT =
  "id, name, motivation, country, community_identifiers, description";

// The ingest attributes intel by nexus, so derive it from the actor's
// motivation + country (the four tracked states map to their own nexus, other
// nation-states to rest_of_world, and eCrime/hacktivism to other).
function nexusFor(motivation: Motivation, country: string | null): Nexus {
  if (motivation !== "nation_state") return "other";
  switch ((country ?? "").trim().toLowerCase()) {
    case "china":
      return "china";
    case "russia":
      return "russia";
    case "north korea":
      return "north_korea";
    case "iran":
      return "iran";
    default:
      return "rest_of_world";
  }
}

function actorRow(input: ActorInput) {
  const motivation = MOTIVATIONS.includes(input.motivation as Motivation)
    ? (input.motivation as Motivation)
    : "nation_state";
  // Country only applies to nation-state actors.
  const country =
    motivation === "nation_state"
      ? toAscii(input.country).trim() || null
      : null;
  return {
    name: toAscii(input.name).trim(),
    motivation: [motivation],
    country,
    nexus: nexusFor(motivation, country),
    community_identifiers: toList(input.aliases),
    description: toAscii(input.description).trim() || null,
  };
}

/**
 * Rescan currently-unattributed reports against one adversary's aliases and,
 * where the text matches, attribute them to it (updating country + motivation).
 * Only reports with no specific adversary (crowdstrike_adversary null and no
 * label, or a generic "UNID ..." label) are ever changed. Returns the count.
 */
async function rescanUnattributed(
  db: ReturnType<typeof createAdminClient>,
  id: string,
): Promise<number> {
  const { data: adv } = await db
    .from("adversaries")
    .select(
      "name, nexus, country, motivation, community_identifiers, internal_alternative_names",
    )
    .eq("id", id)
    .single();
  if (!adv?.name) return 0;

  const groups = sortGroups(buildGroupsFromAdversaries([adv]));
  if (groups.length === 0) return 0;

  const { data: items } = await db
    .from("intel_items")
    .select("id, title, description, adversary_label")
    .is("crowdstrike_adversary", null);
  const unattributed = (items ?? []).filter(
    (i) => !i.adversary_label || /^unid\s/i.test(i.adversary_label),
  );
  if (unattributed.length === 0) return 0;

  const motivation = adv.motivation?.[0] ?? null;
  let updated = 0;
  for (const it of unattributed) {
    const hay = `${it.title} ${it.description ?? ""}`.toLowerCase();
    if (!matchGroup(hay, groups)) continue;
    const { error } = await db
      .from("intel_items")
      .update({
        crowdstrike_adversary: adv.name,
        adversary_label: adv.name,
        country: adv.country,
        motivation,
      })
      .eq("id", it.id);
    if (!error) updated++;
  }
  return updated;
}

export async function addActor(input: ActorInput): Promise<ActorResult> {
  const unauth = await ensureAuthenticated();
  if (unauth) return { ok: false, error: unauth };
  const row = actorRow(input);
  if (!row.name) return { ok: false, error: "Name is required." };

  const db = createAdminClient();
  const { data, error } = await db
    .from("adversaries")
    .insert(row)
    .select(ACTOR_SELECT)
    .single();
  if (error) return { ok: false, error: error.message };
  // Rescan unattributed reports in the background so the save returns promptly.
  after(() => rescanUnattributed(db, data.id).catch(() => {}));
  revalidatePath("/settings");
  return { ok: true, actor: data as ActorRecord };
}

export async function updateActor(
  id: string,
  input: ActorInput,
): Promise<ActorResult> {
  const unauth = await ensureAuthenticated();
  if (unauth) return { ok: false, error: unauth };
  const row = actorRow(input);
  if (!row.name) return { ok: false, error: "Name is required." };

  const db = createAdminClient();
  const { data, error } = await db
    .from("adversaries")
    .update(row)
    .eq("id", id)
    .select(ACTOR_SELECT)
    .single();
  if (error) return { ok: false, error: error.message };
  after(() => rescanUnattributed(db, data.id).catch(() => {}));
  revalidatePath("/settings");
  return { ok: true, actor: data as ActorRecord };
}

export async function deleteActor(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const unauth = await ensureAuthenticated();
  if (unauth) return { ok: false, error: unauth };
  const db = createAdminClient();
  const { error } = await db.from("adversaries").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}
