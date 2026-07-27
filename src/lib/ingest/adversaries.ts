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
  community_identifiers?: string[] | null;
  internal_alternative_names?: string[] | null;
};

// CrowdStrike animal cryptonyms map to a nation-state nexus. Everything else
// (SPIDER eCrime, JACKAL hacktivist, TIGER/WOLF/etc. other nations) is "other".
const ANIMAL_NEXUS: Record<string, Nexus> = {
  PANDA: "china",
  BEAR: "russia",
  CHOLLIMA: "north_korea",
  KITTEN: "iran",
};

const DESC_NEXUS: Array<[RegExp, Nexus]> = [
  [/\b(north korea|dprk)[ -]?nexus/i, "north_korea"],
  [/\b(china|chinese|prc)[ -]?nexus/i, "china"],
  [/\b(russia|russian)[ -]?nexus/i, "russia"],
  [/\b(iran|iranian)[ -]?nexus/i, "iran"],
];

/**
 * Derive the nexus for an adversary. The animal classifier is authoritative
 * (CrowdStrike taxonomy); for unclassified adversaries we fall back to the
 * "<country>-nexus" phrasing used consistently in the descriptions.
 */
export function deriveNexus(a: AdversaryRecord): Nexus {
  const animal = a.animal_classifier?.toUpperCase();
  if (animal) return ANIMAL_NEXUS[animal] ?? "other";
  const desc = `${a.description ?? ""} ${a.short_description ?? ""}`;
  for (const [re, nexus] of DESC_NEXUS) if (re.test(desc)) return nexus;
  return "other";
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
