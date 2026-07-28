import type { Nexus } from "@/lib/badges";
import type { GroupEntry } from "./enrich/rules";

/**
 * A CrowdStrike adversary record as it appears in adversaries.json and, after
 * loading, in the `adversaries` table.
 */
export type AdversaryRecord = {
  name?: string | null;
  animal_classifier?: string | null;
  description?: string | null;
  short_description?: string | null;
  motivation?: string[] | null;
  community_identifiers?: string[] | null;
  internal_alternative_names?: string[] | null;
};

// The four tracked nation-states map from their CrowdStrike animal cryptonym.
const ANIMAL_NEXUS: Record<string, Nexus> = {
  PANDA: "china",
  BEAR: "russia",
  CHOLLIMA: "north_korea",
  KITTEN: "iran",
};

// Non-state cryptonyms: SPIDER (eCrime) and JACKAL (hacktivist) -> "other".
// Every other animal (TIGER, WOLF, BUFFALO, SPHINX, ...) is a state-sponsored
// adversary from a country outside the big four -> "rest_of_world".
const NON_STATE_ANIMALS = new Set(["SPIDER", "JACKAL"]);

const DESC_NEXUS: Array<[RegExp, Nexus]> = [
  [/\b(north korea|dprk)[ -]?nexus/i, "north_korea"],
  [/\b(china|chinese|prc)[ -]?nexus/i, "china"],
  [/\b(russia|russian)[ -]?nexus/i, "russia"],
  [/\b(iran|iranian)[ -]?nexus/i, "iran"],
];

/**
 * Derive the nexus for an adversary:
 *   - the four tracked nation-states from their animal cryptonym;
 *   - other state-animal cryptonyms -> rest_of_world;
 *   - SPIDER / JACKAL -> other (eCrime / hacktivist);
 *   - unclassified: a "<country>-nexus" phrase pins one of the four, otherwise
 *     a StateSponsored motivation -> rest_of_world, else other.
 */
export function deriveNexus(a: AdversaryRecord): Nexus {
  const animal = a.animal_classifier?.toUpperCase();
  if (animal) {
    if (ANIMAL_NEXUS[animal]) return ANIMAL_NEXUS[animal];
    return NON_STATE_ANIMALS.has(animal) ? "other" : "rest_of_world";
  }

  const desc = `${a.description ?? ""} ${a.short_description ?? ""}`;
  for (const [re, nexus] of DESC_NEXUS) if (re.test(desc)) return nexus;

  const stateSponsored = (a.motivation ?? []).some(
    (m) => m.toLowerCase() === "statesponsored",
  );
  return stateSponsored ? "rest_of_world" : "other";
}

// Aliases shorter than this are too generic to match safely.
const MIN_ALIAS_LEN = 4;

/**
 * Build alias -> {nexus, crowdstrike name} matcher entries from adversary
 * records. Each adversary contributes its CrowdStrike name plus its community
 * and internal aliases, all pointing at that adversary's cryptonym + nexus.
 */
export function buildGroupsFromAdversaries(
  records: AdversaryRecord[],
): GroupEntry[] {
  const entries: GroupEntry[] = [];
  const seen = new Set<string>();

  for (const a of records) {
    if (!a.name) continue;
    const nexus = deriveNexus(a);
    const aliases = [
      a.name,
      ...(a.community_identifiers ?? []),
      ...(a.internal_alternative_names ?? []),
    ];
    for (const raw of aliases) {
      const alias = (raw ?? "").trim().toLowerCase();
      if (alias.length < MIN_ALIAS_LEN) continue;
      const key = `${alias}|${a.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ alias, nexus, cs: a.name });
    }
  }
  return entries;
}
