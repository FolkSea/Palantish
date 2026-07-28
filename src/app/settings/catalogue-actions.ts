"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEmailAllowed } from "@/lib/env";
import { toAscii } from "@/lib/text";
import {
  FAMILY_FOCI,
  type ActorInput,
  type ActorRecord,
  type ActorResult,
  type FamilyInput,
  type FamilyRecord,
  type FamilyResult,
} from "@/lib/actor-catalogue";

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
  "id, name, animal_classifier, motivation, community_identifiers, description";

function actorRow(input: ActorInput) {
  return {
    name: toAscii(input.name).trim(),
    animal_classifier: toAscii(input.animalClassifier).trim() || null,
    motivation: toList(input.motivation),
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

/* --- Actor families (animal -> focus / country) --------------------------- */

function familyRow(input: FamilyInput) {
  return {
    animal: toAscii(input.animal).trim(),
    focus: input.focus,
    country: toAscii(input.country).trim() || null,
  };
}

function cleanFamily(input: FamilyInput): string | null {
  if (!toAscii(input.animal).trim()) return "Animal is required.";
  if (!FAMILY_FOCI.includes(input.focus)) return "Invalid focus.";
  return null;
}

export async function addFamily(input: FamilyInput): Promise<FamilyResult> {
  const unauth = await requireAllowed();
  if (unauth) return { ok: false, error: unauth };
  const invalid = cleanFamily(input);
  if (invalid) return { ok: false, error: invalid };

  const db = createAdminClient();
  const { data, error } = await db
    .from("actor_families")
    .insert(familyRow(input))
    .select("id, animal, focus, country")
    .single();
  if (error) {
    return {
      ok: false,
      error: error.message.includes("duplicate")
        ? "That animal already has a family."
        : error.message,
    };
  }
  revalidatePath("/settings");
  return { ok: true, family: data as FamilyRecord };
}

export async function updateFamily(
  id: string,
  input: FamilyInput,
): Promise<FamilyResult> {
  const unauth = await requireAllowed();
  if (unauth) return { ok: false, error: unauth };
  const invalid = cleanFamily(input);
  if (invalid) return { ok: false, error: invalid };

  const db = createAdminClient();
  const { data, error } = await db
    .from("actor_families")
    .update(familyRow(input))
    .eq("id", id)
    .select("id, animal, focus, country")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true, family: data as FamilyRecord };
}

export async function deleteFamily(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const unauth = await requireAllowed();
  if (unauth) return { ok: false, error: unauth };
  const db = createAdminClient();
  const { error } = await db.from("actor_families").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}
