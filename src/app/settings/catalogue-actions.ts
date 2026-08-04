"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureAuthenticated, getAdministratorClient } from "@/lib/auth";
import { findActorCollision } from "@/lib/actor-collision";
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

async function requireAdministrator(): Promise<
  { ok: false; error: string } | null
> {
  return (await getAdministratorClient())
    ? null
    : { ok: false, error: "Administrator access required." };
}

/**
 * Add an actor the catalogue does not have.
 *
 * Open to any analyst, because meeting an unlisted actor mid-report is exactly
 * when one gets added, and the report viewer is where that happens. Strictly
 * create, though: an analyst may introduce an actor but never redefine one, so
 * a proposal colliding with an existing name or alias is refused rather than
 * merged. Changing and removing entries stay with administrators.
 *
 * The rescan that follows only fills in reports with no specific adversary (see
 * rescanUnattributed), so adding cannot re-point existing attribution.
 */
export async function addActor(input: ActorInput): Promise<ActorResult> {
  const unauth = await ensureAuthenticated();
  if (unauth) return { ok: false, error: unauth };
  const row = actorRow(input);
  if (!row.name) return { ok: false, error: "Name is required." };

  const db = createAdminClient();

  // Checked here so the analyst is told which actor they have hit and under
  // which name; the unique index on lower(name) is the backstop for the race
  // between this read and the insert.
  const { data: existing } = await db
    .from("adversaries")
    .select("id, name, community_identifiers, internal_alternative_names");
  const clash = findActorCollision(
    { name: row.name, aliases: row.community_identifiers },
    (existing ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      aliases: [
        ...(a.community_identifiers ?? []),
        ...(a.internal_alternative_names ?? []),
      ],
    })),
  );
  if (clash) {
    return {
      ok: false,
      error:
        `"${clash.actor.name}" already covers "${clash.on}". ` +
        `Ask an administrator to amend it rather than adding a second entry.`,
    };
  }

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

/** Amend an actor. Administrators only: an edit redefines who existing and
 * future reporting is attributed to, across the whole corpus. */
export async function updateActor(
  id: string,
  input: ActorInput,
): Promise<ActorResult> {
  const denied = await requireAdministrator();
  if (denied) return denied;
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

/** Remove an actor. Administrators only, for the same reason as amending. */
export async function deleteActor(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const denied = await requireAdministrator();
  if (denied) return denied;
  const db = createAdminClient();
  const { error } = await db.from("adversaries").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}
