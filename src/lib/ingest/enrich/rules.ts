import type { Nexus, Confidence } from "@/lib/badges";
import { computeHash } from "@/lib/ingest/dedup";
import type { Enricher, EnrichedItem, ItemType, RawCandidate } from "@/lib/ingest/types";

/**
 * Known threat-group aliases mapped to their nation-state nexus and, where a
 * public CrowdStrike cryptonym exists, that adversary name. Matching is
 * case-insensitive substring on the combined title+description.
 */
type GroupEntry = { alias: string; nexus: Nexus; cs?: string };

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

/** Returns the matched group entry (nexus + optional CS name) or null. */
export function classifyGroup(c: RawCandidate): GroupEntry | null {
  const hay = haystack(c);
  // Longest alias first so "fancy bear" wins over "bear".
  const sorted = [...GROUP_TABLE].sort((a, b) => b.alias.length - a.alias.length);
  return sorted.find((g) => hay.includes(g.alias)) ?? null;
}

export function isMarketing(c: RawCandidate): boolean {
  return MARKETING_RE.test(c.title) || MARKETING_RE.test(c.description ?? "");
}

export function isLargeScaleEcrime(c: RawCandidate): boolean {
  return LARGE_SCALE_RE.test(haystack(c));
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

/**
 * Rules-based default enricher. Deterministic, no network. Drops marketing and
 * low-signal eCrime. Used whenever the LLM enricher is not configured.
 */
export class RulesEnricher implements Enricher {
  readonly name = "rules";

  async enrich(c: RawCandidate): Promise<EnrichedItem | null> {
    if (!c.title || !c.url) return null;
    if (isMarketing(c)) return null;

    const group = classifyGroup(c);

    // eCrime / "other" nexus only qualifies when clearly large-scale.
    if (group?.nexus === "other" && !isLargeScaleEcrime(c)) return null;

    const itemType = classifyItemType(c, group);

    // Drop generic vendor/news posts with no nation-state nexus and no
    // vuln/breach signal - they are not intelligence for this dashboard.
    if (!group && itemType === "report" && c.sourceCategory === "news") {
      return null;
    }

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
}
