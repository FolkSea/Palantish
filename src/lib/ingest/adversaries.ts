import { ANIMAL_COUNTRY, type Nexus } from "@/lib/badges";
import type { Motivation } from "@/lib/actor-catalogue";
import { nexusForCountry } from "@/lib/actor-classify";
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

// Motivation per family; every other family is a state-sponsored actor. The
// countries come from ANIMAL_COUNTRY so this file cannot disagree with the
// labels the dashboard renders.
const ANIMAL_MOTIVATION: Record<string, Motivation> = {
  SPIDER: "ecrime",
  JACKAL: "hacktivism",
};

const ANIMAL_FAMILY: Record<string, { motivation: Motivation; country: string | null }> =
  Object.fromEntries(
    Object.entries(ANIMAL_COUNTRY).map(([animal, country]) => [
      animal,
      { motivation: ANIMAL_MOTIVATION[animal] ?? "nation_state", country },
    ]),
  );

/** Classify a CrowdStrike animal (family), e.g. "BAT" -> nation_state / null. */
export function familyForAnimal(
  animal: string,
): { motivation: Motivation; country: string | null } | null {
  return ANIMAL_FAMILY[animal.trim().toUpperCase()] ?? null;
}

// Country name for the four tracked nexuses (fallback when the animal is not in
// the family table above).
const NEXUS_COUNTRY: Partial<Record<Nexus, string>> = {
  china: "China",
  russia: "Russia",
  north_korea: "North Korea",
  iran: "Iran",
};

/** Derive an actor's motivation from its animal, nexus, or legacy motivation. */
export function deriveMotivation(a: AdversaryRecord): Motivation {
  const animal = a.animal_classifier?.toUpperCase();
  if (animal && ANIMAL_FAMILY[animal]) return ANIMAL_FAMILY[animal].motivation;
  const nexus = deriveNexus(a);
  if (nexus !== "other") return "nation_state";
  const legacy = (a.motivation ?? []).map((m) => m.toLowerCase());
  if (legacy.includes("hacktivism")) return "hacktivism";
  return "ecrime";
}

/** Derive an actor's country (nation-state only), else null. */
export function deriveCountry(a: AdversaryRecord): string | null {
  const animal = a.animal_classifier?.toUpperCase();
  if (animal && ANIMAL_FAMILY[animal]) return ANIMAL_FAMILY[animal].country;
  return NEXUS_COUNTRY[deriveNexus(a)] ?? null;
}

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

/** The stored adversary shape used to build the alias matcher (nexus + motivation
 * come straight from the row - derived at load time). */
export type AdversaryGroupInput = {
  name?: string | null;
  nexus?: Nexus | null;
  motivation?: string[] | null;
  community_identifiers?: string[] | null;
  internal_alternative_names?: string[] | null;
};

/**
 * Build alias -> {nexus, crowdstrike name} matcher entries from adversary
 * records. Each adversary contributes its CrowdStrike name plus its community
 * and internal aliases, all pointing at that adversary's cryptonym + nexus.
 */
export function buildGroupsFromAdversaries(
  records: AdversaryGroupInput[],
): GroupEntry[] {
  const entries: GroupEntry[] = [];
  const seen = new Set<string>();

  for (const a of records) {
    if (!a.name) continue;
    const nexus = (a.nexus ?? "other") as Nexus;
    const motivation = (a.motivation?.[0] as Motivation | undefined) ?? undefined;
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
      entries.push({ alias, nexus, cs: a.name, motivation });
    }
  }
  return entries;
}

/**
 * A raw record as it appears in adversaries.json - either the curated format
 * (explicit `motivation` string + `country`) or the legacy CrowdStrike export
 * (motivation array + animal_classifier).
 */
export type RawAdversaryRecord = {
  ID?: string;
  cs_id?: string;
  name?: string;
  animal_classifier?: string | null;
  status?: string | null;
  description?: string | null;
  short_description?: string | null;
  first_seen?: string | null;
  last_seen?: string | null;
  objectives?: string[] | null;
  motivation?: string | string[] | null;
  country?: string | null;
  targeting_profile?: string[] | null;
  community_identifiers?: string[] | null;
  internal_alternative_names?: string[] | null;
};

/** A row ready to upsert into the `adversaries` table (nexus/motivation/country
 * resolved). Also the shape buildGroupsFromAdversaries consumes. */
export type AdversaryRow = {
  cs_id: string;
  name: string;
  nexus: Nexus;
  motivation: string[];
  country: string | null;
  status: string | null;
  description: string | null;
  short_description: string | null;
  first_seen: string | null;
  last_seen: string | null;
  objectives: string[] | null;
  targeting_profile: string[] | null;
  community_identifiers: string[] | null;
  internal_alternative_names: string[] | null;
};

const OUR_MOTIVATIONS = new Set<string>(["nation_state", "ecrime", "hacktivism"]);

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Map raw adversaries.json records to table rows, resolving nexus / motivation /
 * country. Shared by the loader (scripts/load-adversaries) and tests so both see
 * exactly the classification the app uses - the `adversaries` catalogue is the
 * single source of actor identity. Pure (no DB, no fs).
 */
export function mapAdversaryRecords(raw: RawAdversaryRecord[]): AdversaryRow[] {
  return raw
    .filter((a) => a.name)
    .map((a) => {
      // Prefer explicit motivation + country (the curated format); fall back to
      // deriving them from the CrowdStrike animal cryptonym (legacy format).
      const explicit =
        typeof a.motivation === "string" && OUR_MOTIVATIONS.has(a.motivation);
      const legacy: AdversaryRecord = {
        ...a,
        motivation: Array.isArray(a.motivation) ? a.motivation : null,
      };
      const motivation = explicit
        ? (a.motivation as string)
        : deriveMotivation(legacy);
      const country = explicit ? a.country ?? null : deriveCountry(legacy);
      const nexus = explicit
        ? motivation === "nation_state"
          ? nexusForCountry(country)
          : "other"
        : deriveNexus(legacy);
      return {
        cs_id: a.cs_id ?? a.ID ?? slug(a.name!),
        name: a.name!,
        nexus,
        motivation: [motivation],
        country,
        status: a.status ?? null,
        description: a.description ?? null,
        short_description: a.short_description ?? null,
        first_seen: a.first_seen ?? null,
        last_seen: a.last_seen ?? null,
        objectives: a.objectives ?? null,
        targeting_profile: a.targeting_profile ?? null,
        community_identifiers: a.community_identifiers ?? null,
        internal_alternative_names: a.internal_alternative_names ?? null,
      };
    });
}
