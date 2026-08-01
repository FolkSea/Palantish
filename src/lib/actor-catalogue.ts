// Shared types and constants for the Actors (adversaries) catalogue. Kept out
// of the "use server" actions file, which may only export async server actions -
// importing a plain const from there breaks the client.

export type Motivation = "nation_state" | "ecrime" | "hacktivism";

export const MOTIVATIONS: Motivation[] = [
  "nation_state",
  "ecrime",
  "hacktivism",
];

export const MOTIVATION_LABEL: Record<Motivation, string> = {
  nation_state: "Nation State",
  ecrime: "eCrime",
  hacktivism: "Hacktivism",
};

export type ActorInput = {
  name: string;
  motivation: string; // one of Motivation
  country: string; // free text; only meaningful for nation_state
  aliases: string; // comma-separated
  description: string;
};

export type ActorRecord = {
  id: string;
  name: string;
  motivation: string[] | null;
  country: string | null;
  community_identifiers: string[] | null;
  description: string | null;
};

export type ActorResult =
  | { ok: true; actor: ActorRecord }
  | { ok: false; error: string };
