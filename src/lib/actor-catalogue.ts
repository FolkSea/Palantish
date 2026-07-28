// Shared types and constants for the Actors (adversaries) and Actor Families
// settings. Kept out of the "use server" actions file, which may only export
// async server actions - importing a plain const from there breaks the client.

/* --- Actors (adversaries catalogue) --------------------------------------- */

export type ActorInput = {
  name: string;
  animalClassifier: string;
  motivation: string; // comma-separated
  aliases: string; // comma-separated
  description: string;
};

export type ActorRecord = {
  id: string;
  name: string;
  animal_classifier: string | null;
  motivation: string[] | null;
  community_identifiers: string[] | null;
  description: string | null;
};

export type ActorResult =
  | { ok: true; actor: ActorRecord }
  | { ok: false; error: string };

/* --- Actor families (animal -> focus / country) --------------------------- */

export type FamilyFocus = "ecrime" | "nation_state" | "hacktivism";

export const FAMILY_FOCI: FamilyFocus[] = [
  "ecrime",
  "nation_state",
  "hacktivism",
];

export const FOCUS_LABEL: Record<FamilyFocus, string> = {
  ecrime: "eCrime",
  nation_state: "Nation State",
  hacktivism: "Hacktivism",
};

export type FamilyInput = { animal: string; focus: FamilyFocus; country: string };

export type FamilyRecord = {
  id: string;
  animal: string;
  focus: FamilyFocus;
  country: string | null;
};

export type FamilyResult =
  | { ok: true; family: FamilyRecord }
  | { ok: false; error: string };
