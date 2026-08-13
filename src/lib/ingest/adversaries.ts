import { ANIMAL_COUNTRY, type Nexus } from "@/lib/badges";
import type { Motivation } from "@/lib/actor-catalogue";
import type { GroupEntry } from "./enrich/rules";
import { isMatchableAlias } from "./alias-quality";

// The `adversaries` table is the only catalogue. It used to be loaded from a
// committed adversaries.json, which meant an actor deleted in the app came
// back the next time anyone ran the loader - so the file, the loader, and the
// code that mapped one into the other are all gone. What is left here reads
// rows that already exist.

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
      // An alias that is also an ordinary word attributes everything it reads.
      if (!isMatchableAlias(alias)) continue;
      const key = `${alias}|${a.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ alias, nexus, cs: a.name, motivation });
    }
  }
  return entries;
}
