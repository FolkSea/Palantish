import type { Nexus, Confidence } from "@/lib/badges";
import { computeHash } from "@/lib/ingest/dedup";
import type { Enricher, EnrichedItem, ItemType, RawCandidate } from "@/lib/ingest/types";

/**
 * Known threat-group aliases mapped to their nation-state nexus and, where a
 * public CrowdStrike cryptonym exists, that adversary name. Matching is
 * case-insensitive substring on the combined title+description.
 */
export type GroupEntry = { alias: string; nexus: Nexus; cs?: string };

export const GROUP_TABLE: GroupEntry[] = [
  // North Korea (Chollima)
  { alias: "lazarus", nexus: "north_korea", cs: "Labyrinth Chollima" },
  { alias: "apt38", nexus: "north_korea", cs: "Stardust Chollima" },
  { alias: "bluenoroff", nexus: "north_korea", cs: "Stardust Chollima" },
  { alias: "kimsuky", nexus: "north_korea", cs: "Velvet Chollima" },
  { alias: "andariel", nexus: "north_korea", cs: "Silent Chollima" },
  { alias: "chollima", nexus: "north_korea" },
  { alias: "north korea", nexus: "north_korea" },
  { alias: "dprk", nexus: "north_korea" },
  // Russia (Bear)
  { alias: "apt28", nexus: "russia", cs: "Fancy Bear" },
  { alias: "fancy bear", nexus: "russia", cs: "Fancy Bear" },
  { alias: "apt29", nexus: "russia", cs: "Cozy Bear" },
  { alias: "cozy bear", nexus: "russia", cs: "Cozy Bear" },
  { alias: "midnight blizzard", nexus: "russia", cs: "Cozy Bear" },
  { alias: "sandworm", nexus: "russia", cs: "Voodoo Bear" },
  { alias: "turla", nexus: "russia", cs: "Venomous Bear" },
  { alias: "gamaredon", nexus: "russia", cs: "Primitive Bear" },
  { alias: "bear", nexus: "russia" },
  // China (Panda)
  { alias: "apt41", nexus: "china", cs: "Wicked Panda" },
  { alias: "volt typhoon", nexus: "china", cs: "Vanguard Panda" },
  { alias: "salt typhoon", nexus: "china" },
  { alias: "mustang panda", nexus: "china", cs: "Mustang Panda" },
  { alias: "apt31", nexus: "china", cs: "Judgment Panda" },
  { alias: "apt10", nexus: "china", cs: "Stone Panda" },
  { alias: "aquatic panda", nexus: "china", cs: "Aquatic Panda" },
  { alias: "panda", nexus: "china" },
  // Iran (Kitten)
  { alias: "charming kitten", nexus: "iran", cs: "Charming Kitten" },
  { alias: "apt35", nexus: "iran", cs: "Charming Kitten" },
  { alias: "muddywater", nexus: "iran", cs: "Static Kitten" },
  { alias: "oilrig", nexus: "iran", cs: "Helix Kitten" },
  { alias: "apt34", nexus: "iran", cs: "Helix Kitten" },
  { alias: "apt33", nexus: "iran", cs: "Refined Kitten" },
  { alias: "imperial kitten", nexus: "iran", cs: "Imperial Kitten" },
  { alias: "kitten", nexus: "iran" },
  // eCrime (Spider) - only surfaced when large-scale, see isLargeScaleEcrime
  { alias: "scattered spider", nexus: "other", cs: "Scattered Spider" },
  { alias: "wizard spider", nexus: "other", cs: "Wizard Spider" },
  { alias: "lockbit", nexus: "other" },
  { alias: "alphv", nexus: "other" },
  { alias: "blackcat", nexus: "other" },
  { alias: "cl0p", nexus: "other" },
  { alias: "clop", nexus: "other" },
];

const MARKETING_RE =
  /\b(webinar|introducing|announc|acquir|acquisition|partner(ship)?|pricing|gartner|magic quadrant|now available|product update|forrester|sponsor|join us|register (now|today)|ebook|whitepaper series|customer story|case study)\b/i;

const CVE_RE = /\bCVE-\d{4}-\d{3,7}\b/i;

const BREACH_RE =
  /\b(data breach|breached|suffered a breach|hacked|leaked (data|records)|stolen data|exfiltrated|extortion|ransom(ware)? (attack|incident))\b/i;

const LARGE_SCALE_RE =
  /\b(mass|widespread|hundreds|thousands|dozens of (victims|organi[sz]ations)|supply.chain|global campaign|multiple (victims|sectors|organi[sz]ations)|critical infrastructure|zero.day)\b/i;

const CONFIRMED_RE =
  /\b(confirmed|disclosed|acknowledged|patched|actively exploited|exploited in the wild|advisory)\b/i;

const POC_RE = /\b(proof.of.concept|\bpoc\b|not yet (exploited|observed))\b/i;

function haystack(c: RawCandidate): string {
  return `${c.title} ${c.description ?? ""}`.toLowerCase();
}

/** True if `alias` appears in `hay` on word boundaries (both lower-cased). */
function wordBoundaryIncludes(hay: string, alias: string): boolean {
  let idx = hay.indexOf(alias);
  while (idx !== -1) {
    const before = idx === 0 ? " " : hay[idx - 1];
    const after = idx + alias.length >= hay.length ? " " : hay[idx + alias.length];
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    idx = hay.indexOf(alias, idx + 1);
  }
  return false;
}

/** Sort group entries longest-alias-first so specific names beat generic ones. */
export function sortGroups(groups: GroupEntry[]): GroupEntry[] {
  return [...groups].sort((a, b) => b.alias.length - a.alias.length);
}

/** First group whose alias matches the haystack on word boundaries. */
export function matchGroup(
  hay: string,
  sortedGroups: GroupEntry[],
): GroupEntry | null {
  return sortedGroups.find((g) => wordBoundaryIncludes(hay, g.alias)) ?? null;
}

/** Returns the matched group entry (nexus + optional CS name) or null. */
export function classifyGroup(c: RawCandidate): GroupEntry | null {
  return matchGroup(haystack(c), sortGroups(GROUP_TABLE));
}

/**
 * Surface a specific adversary name mentioned in the text (original casing) when
 * no CrowdStrike cryptonym applies - e.g. "Salt Typhoon". Generic single-word
 * aliases (panda/bear/...) are ignored so only real names are shown.
 */
export function deriveAdversaryFromText(
  title: string,
  description: string | null | undefined,
  groups: GroupEntry[],
): string | null {
  const text = `${title} ${description ?? ""}`;
  const group = matchGroup(text.toLowerCase(), groups);
  if (!group) return null;
  if (group.cs) return group.cs;
  if (!group.alias.includes(" ")) return null;
  const idx = text.toLowerCase().indexOf(group.alias);
  return idx >= 0 ? text.slice(idx, idx + group.alias.length) : null;
}

export function isMarketing(c: RawCandidate): boolean {
  return MARKETING_RE.test(c.title) || MARKETING_RE.test(c.description ?? "");
}

export function isLargeScaleEcrime(c: RawCandidate): boolean {
  return LARGE_SCALE_RE.test(haystack(c));
}

// Known hacktivist collectives (distinctive, ASCII-only names). Single source of
// truth, also used by the activity-by-actor hacktivism section.
export const KNOWN_HACKTIVISM_NAMES = [
  "Anonymous Sudan",
  "NoName057(16)",
  "NoName057",
  "KillNet",
  "IT Army of Ukraine",
  "SiegedSec",
  "GhostSec",
  "Cyber Av3ngers",
  "Handala",
  "Mysterious Team Bangladesh",
  "Team Insane PK",
  "RipperSec",
  "Dark Storm Team",
  "Turk Hack Team",
  "SylhetGang",
  "CyberVolk",
  "Holy League",
  "Hunt3r Kill3rs",
];

const HACKTIVISM_RE = /\bhacktivis(?:m|t|ts)\b/i;

/** Hacktivist collective aliases, sorted longest-first for matching. */
export function buildHacktivismGroups(): GroupEntry[] {
  return sortGroups(
    KNOWN_HACKTIVISM_NAMES.map((n) => ({
      alias: n.toLowerCase(),
      nexus: "other" as const,
      cs: n,
    })),
  );
}

const HACKTIVISM_GROUPS = buildHacktivismGroups();

/** True when text reads as hacktivism (independent of a named collective). */
export function hasHacktivismKeyword(text: string): boolean {
  return HACKTIVISM_RE.test(text);
}

/** True when the candidate names a hacktivist collective or reads as hacktivism. */
export function isHacktivism(c: RawCandidate): boolean {
  const hay = haystack(c);
  return HACKTIVISM_RE.test(hay) || matchGroup(hay, HACKTIVISM_GROUPS) !== null;
}

export function classifyItemType(
  c: RawCandidate,
  group: GroupEntry | null,
): ItemType {
  const hay = haystack(c);
  if (CVE_RE.test(hay)) return "vuln";
  if (BREACH_RE.test(hay)) return "breach";
  // Large-scale eCrime that reaches this point (small-scale is dropped earlier)
  // is a breach-type event, not an actor-activity card.
  if (group?.nexus === "other") return "breach";
  if (group) return "actor_activity";
  // News-category, high-signal items become breaking headlines.
  if (c.sourceCategory === "news" && (BREACH_RE.test(hay) || LARGE_SCALE_RE.test(hay)))
    return "breaking";
  return "report";
}

export function classifyConfidence(c: RawCandidate): Confidence {
  const hay = haystack(c);
  if (POC_RE.test(hay)) return "poc";
  if (c.sourceCategory === "government" || CONFIRMED_RE.test(hay))
    return "confirmed";
  return "suspected";
}

/** Build the persisted item from a candidate + its (optional) matched group. */
export function buildEnriched(
  c: RawCandidate,
  group: GroupEntry | null,
  itemType: ItemType,
): EnrichedItem {
  return {
    title: c.title,
    description: c.description,
    url: c.url,
    publishedAt: c.publishedAt ?? new Date(),
    nexus: group?.nexus ?? null,
    itemType,
    confidence: classifyConfidence(c),
    crowdstrikeAdversary: group?.cs ?? null,
    sourceName: c.sourceName,
    rawHash: computeHash(c.title, c.url),
  };
}

/** Force a candidate into a plain report (used as the keep-by-default fallback). */
export function buildReport(c: RawCandidate): EnrichedItem {
  return buildEnriched(c, null, "report");
}

/**
 * Deterministic verdict for a candidate:
 *  - keep:   confident classification (known actor, CVE, breach, breaking, or a
 *            vendor/research/government report).
 *  - drop:   clearly not intelligence (marketing, or small-scale eCrime).
 *  - unsure: an ambiguous generic news post with no threat signal - the caller
 *            decides (the hybrid enricher escalates these to the LLM).
 */
export type RulesVerdict =
  | { kind: "keep"; item: EnrichedItem }
  | { kind: "drop" }
  | { kind: "unsure" };

export function rulesClassify(
  c: RawCandidate,
  groups: GroupEntry[],
): RulesVerdict {
  if (!c.title || !c.url) return { kind: "drop" };
  if (isMarketing(c)) return { kind: "drop" };

  const group = matchGroup(haystack(c), groups);
  // eCrime / "other" nexus only qualifies when clearly large-scale.
  if (group?.nexus === "other" && !isLargeScaleEcrime(c)) return { kind: "drop" };

  const itemType = classifyItemType(c, group);
  // Hacktivist activity (named collective or explicit hacktivism) is genuine
  // intelligence - keep it rather than letting it fall into the ambiguous
  // news bucket where it could be dropped.
  if (isHacktivism(c)) {
    return { kind: "keep", item: buildEnriched(c, group, itemType) };
  }
  // A generic news post with no nation-state nexus and no vuln/breach signal is
  // ambiguous - not obviously marketing, but not obviously intelligence either.
  if (!group && itemType === "report" && c.sourceCategory === "news") {
    return { kind: "unsure" };
  }
  return { kind: "keep", item: buildEnriched(c, group, itemType) };
}

/**
 * Rules-based default enricher. Deterministic, no network. Drops marketing and
 * low-signal eCrime, and drops ambiguous news (no LLM to escalate to).
 */
export class RulesEnricher implements Enricher {
  readonly name = "rules";
  private readonly groups: GroupEntry[];

  /**
   * @param extraGroups adversary aliases loaded from the `adversaries` table.
   * These take priority (checked longest-first alongside the built-in table),
   * giving CrowdStrike-name and nexus coverage far beyond the hard-coded list.
   */
  constructor(extraGroups: GroupEntry[] = []) {
    this.groups = sortGroups([...extraGroups, ...GROUP_TABLE]);
  }

  async enrich(c: RawCandidate): Promise<EnrichedItem | null> {
    const v = rulesClassify(c, this.groups);
    return v.kind === "keep" ? v.item : null;
  }
}
