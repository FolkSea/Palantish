import type { GroupEntry } from "@/lib/ingest/enrich/rules";
import { sortGroups, matchGroup } from "@/lib/ingest/enrich/rules";

// Well-known eCrime / ransomware / extortion crews that may not have a
// CrowdStrike cryptonym in the catalogue. Distinctive names only (no generic
// words like "play" / "storm" that would over-match).
export const KNOWN_ECRIME_NAMES = [
  "LockBit",
  "ALPHV",
  "BlackCat",
  "Scattered Spider",
  "Cl0p",
  "Clop",
  "Qilin",
  "Akira",
  "RansomHub",
  "Medusa",
  "Black Basta",
  "BianLian",
  "Rhysida",
  "Hunters International",
  "8Base",
  "ShinyHunters",
  "Lapsus$",
  "Lapsus",
  "DragonForce",
  "Trigona",
  "INC Ransom",
  "Vice Society",
  "Snatch",
  "Fairlife",
];

/**
 * Combine catalogue eCrime aliases (which carry CrowdStrike cryptonyms) with a
 * list of well-known crew names, sorted longest-first for matching.
 */
export function buildEcrimeActorGroups(catalogueGroups: GroupEntry[]): GroupEntry[] {
  const known: GroupEntry[] = KNOWN_ECRIME_NAMES.map((n) => ({
    alias: n.toLowerCase(),
    nexus: "other" as const,
    cs: n,
  }));
  return sortGroups([...catalogueGroups, ...known]);
}

/**
 * Label an eCrime incident by actor: the CrowdStrike cryptonym when the text
 * matches a catalogue adversary, else the named crew, else "Unattributed".
 */
export function deriveEcrimeActor(
  text: string,
  sortedGroups: GroupEntry[],
): string {
  return matchGroup(text.toLowerCase(), sortedGroups)?.cs ?? "Unattributed";
}
