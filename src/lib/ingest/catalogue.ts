// Adding an actor the catalogue does not have yet.
//
// Reporting names actors faster than anybody curates a catalogue. When the
// model reads a report and names one, the name has to land somewhere: storing
// it on the item alone produces an actor that the dashboard shows, the browse
// pages link to, and the catalogue has never heard of - so the attribution
// cannot be edited, the aliases cannot be matched, and no later report joins up
// with it.
//
// So an actor named in reporting is created here, marked provisional, for an
// analyst to confirm or correct. The bar is deliberately low but not absent:
// the catalogue feeds the alias matcher, and an entry named after an ordinary
// word attributes every report containing that word (which is exactly how
// "LEAD" attributed a page of unrelated reporting to WINNTI GROUP).
//
// The decision parts are pure and unit-tested; the wrapper is the two queries.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { findActorCollision } from "@/lib/actor-collision";
import { isMatchableAlias } from "@/lib/ingest/alias-quality";
import { isSpecificAdversary, type Nexus } from "@/lib/badges";
import { NEXUS_COUNTRY } from "@/lib/actor-classify";
import { toAscii } from "@/lib/text";

type Db = SupabaseClient<Database>;

/** How an actor got into the catalogue. Curated entries carry no status. */
export const PROVISIONAL = "provisional";

export type CatalogueActor = {
  name: string;
  community_identifiers?: (string | null)[] | null;
  internal_alternative_names?: (string | null)[] | null;
};

/**
 * Whether a name the model produced may become a catalogue entry.
 *
 * Rejects the generic placeholders ("UNID PANDA", a bare family) - they are how
 * the dashboard says it does not know, not actors - and anything that would
 * make a dangerous alias.
 */
export function canBeCatalogued(name: string): boolean {
  const n = toAscii(name).trim();
  // isSpecificAdversary rejects a bare family, but "UNID PANDA" is a compound
  // it has no opinion on - and that is the label the dashboard writes for every
  // unattributed China-nexus report, so it would be the first thing catalogued.
  if (/^unid\b/i.test(n)) return false;
  return !!n && isSpecificAdversary(n) && isMatchableAlias(n);
}

/**
 * The catalogue entry that already answers to this name, or null.
 *
 * Aliases count: a report naming Earth Alux is about whichever actor lists it,
 * and creating a second entry would split one actor's reporting in two.
 */
export function resolveKnownActor(
  name: string,
  existing: CatalogueActor[],
): string | null {
  const clash = findActorCollision(
    { name: toAscii(name).trim(), aliases: [] },
    existing.map((a) => ({
      name: a.name,
      aliases: [
        ...(a.community_identifiers ?? []),
        ...(a.internal_alternative_names ?? []),
      ],
    })),
  );
  return clash ? clash.actor.name : null;
}

/** The row to insert for an actor first met in a report. */
export function provisionalActorRow(name: string, nexus: Nexus | null) {
  const country = nexus ? (NEXUS_COUNTRY[nexus] ?? null) : null;
  return {
    name: toAscii(name).trim(),
    nexus: (nexus ?? "other") as Database["public"]["Enums"]["actor_nexus"],
    country,
    // A country means a state nexus; without one, nothing here knows what the
    // actor is after, and guessing would put it in a group on the dashboard.
    motivation: country ? ["nation_state"] : null,
    // No aliases. The report may well have listed some, but an alias attributes
    // every future report that mentions it, and that is a decision for a person.
    community_identifiers: [],
    status: PROVISIONAL,
    short_description: "Named in reporting; added automatically, not reviewed.",
  };
}

export type EnsureActorResult =
  | { name: string; created: boolean }
  | { name: null; created: false };

/**
 * Return the catalogue name for an actor the model named, creating a
 * provisional entry when the catalogue does not have one.
 *
 * Returns `{ name: null }` when the name cannot be catalogued, so callers
 * attribute nothing rather than attributing to something unusable.
 */
export async function ensureCatalogueActor(
  db: Db,
  name: string,
  nexus: Nexus | null,
): Promise<EnsureActorResult> {
  if (!canBeCatalogued(name)) return { name: null, created: false };

  const { data } = await db
    .from("adversaries")
    .select("name, community_identifiers, internal_alternative_names");
  const known = resolveKnownActor(name, data ?? []);
  if (known) return { name: known, created: false };

  const row = provisionalActorRow(name, nexus);
  const { data: inserted, error } = await db
    .from("adversaries")
    .insert(row)
    .select("name")
    .single();
  // Lost the unique(lower(name)) race, or the insert failed: the name is still
  // the right answer if it is now there, and no answer if it is not.
  if (error) {
    const { data: again } = await db
      .from("adversaries")
      .select("name")
      .ilike("name", row.name)
      .maybeSingle();
    return again ? { name: again.name, created: false } : { name: null, created: false };
  }
  return { name: inserted.name, created: true };
}
