"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEmailAllowed } from "@/lib/env";
import { toAscii } from "@/lib/text";
import {
  MOTIVATIONS,
  type ActorInput,
  type ActorRecord,
  type ActorResult,
  type Motivation,
} from "@/lib/actor-catalogue";
import type { Nexus } from "@/lib/badges";

async function requireAllowed(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) return "Not authorized.";
  return null;
}

function toList(csv: string): string[] {
  return csv
    .split(",")
    .map((s) => toAscii(s).trim())
    .filter(Boolean);
}

/* --- Actors (adversaries catalogue) --------------------------------------- */

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

export async function addActor(input: ActorInput): Promise<ActorResult> {
  const unauth = await requireAllowed();
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
  revalidatePath("/settings");
  return { ok: true, actor: data as ActorRecord };
}

export async function updateActor(
  id: string,
  input: ActorInput,
): Promise<ActorResult> {
  const unauth = await requireAllowed();
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
  revalidatePath("/settings");
  return { ok: true, actor: data as ActorRecord };
}

export async function deleteActor(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const unauth = await requireAllowed();
  if (unauth) return { ok: false, error: unauth };
  const db = createAdminClient();
  const { error } = await db.from("adversaries").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}
