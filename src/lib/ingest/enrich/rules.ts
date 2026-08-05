import type { Nexus, Confidence } from "@/lib/badges";
import { adversaryLabel } from "@/lib/badges";
import type { Motivation } from "@/lib/actor-catalogue";
import { computeHash } from "@/lib/ingest/dedup";
import type { Enricher, EnrichedItem, ItemType, RawCandidate } from "@/lib/ingest/types";

/**
 * A threat-group alias mapped to its nexus and, where a public CrowdStrike
 * cryptonym exists, that adversary name plus its motivation. Every entry is
 * derived from the `adversaries` catalogue (see buildGroupsFromAdversaries) -
 * there is no hard-coded actor list. Matching is case-insensitive, on word
 * boundaries, over the combined title+description. `motivation` lets the
 * classifier tell eCrime from hacktivism (both share the "other" nexus).
 */
export type GroupEntry = {
  alias: string;
  nexus: Nexus;
  cs?: string;
  motivation?: Motivation;
};

const MARKETING_RE =
  /\b(webinar|introducing|announc|acquir|acquisition|partner(ship)?|pricing|gartner|magic quadrant|now available|product update|forrester|sponsor|join us|register (now|today)|ebook|whitepaper series|customer story|case study)\b/i;

const CVE_RE = /\bCVE-\d{4}-\d{3,7}\b/i;

const BREACH_RE =
  /\b(data breach|breached|suffered a breach|hacked|leaked (data|records)|stolen data|exfiltrated|extortion|ransom(ware)? (attack|incident))\b/i;

const LARGE_SCALE_RE =
  /\b(mass|widespread|hundreds|thousands|dozens of (victims|organi[sz]ations)|supply.chain|global campaign|multiple (victims|sectors|organi[sz]ations)|critical infrastructure|zero.day)\b/i;

// eCrime substance: a crew-named post describing actual activity - a breach,
// leak, extortion, ransomware incident, attack, intrusion or campaign (kept even
// when it targets a single victim), so ransomware-group activity is never
// dropped as "small-scale". Only a bare mention with none of this is dropped.
const ECRIME_INCIDENT_RE =
  /\b(ransom(ware)?|extort(ion|ed|ing)?|leak(ed|s| site)?|dedicated leak site|\bdls\b|data (leak|dump|breach|for sale|theft)|breach(ed)?|hack(ed|er|ers)?|stole|stolen|exfiltrat|encrypt(ed|ion)?|victim|claim(ed|s|ing)?|listed|posted|initial access|access broker|attack(ed|s|ing)?|target(ed|s|ing)?|compromis(e|ed|es|ing)|hits?\b|deploy(ed|s|ing)?|affiliate|intrusion|campaign)\b/i;

// Research / analysis about a threat actor or its tooling. Such a post names a
// crew but is not itself a breach event, so it is classified as a report rather
// than routed to the breaches table.
const RESEARCH_RE =
  /\b(analysis|analy[sz]ing|analy[sz]ed|deep.?dive|write-?ups?|unpacking|dissect(ing|s|ed)?|reverse.?engineer(ing|ed)?|teardown|anatomy of|a look at|profile of|explained|technical report|malware report|threat (report|research|spotlight)|research (report|paper)|new (tool|toy|malware|variant|loader|backdoor|implant|rootkit|stealer|dropper|framework))\b/i;

const CONFIRMED_RE =
  /\b(confirmed|disclosed|acknowledged|patched|actively exploited|exploited in the wild|advisory)\b/i;

const POC_RE =
  /\b(proof.?of.?concept|\bpoc\b|exploit code|not yet (exploited|observed))\b/i;

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

/**
 * Surface the specific adversary for text that matches a catalogue actor - its
 * CrowdStrike cryptonym or actor name. Returns null when nothing in the
 * catalogue matches. Every catalogue entry carries a `cs` name, so there is no
 * generic-keyword fallback: a bare country mention ("North Korean hackers")
 * matches no actor and yields null, leaving the UNID <animal> label to the
 * caller.
 */
export function deriveAdversaryFromText(
  title: string,
  description: string | null | undefined,
  groups: GroupEntry[],
  /** The fetched article, when there is one. */
  body?: string | null,
): string | null {
  return matchAdversaryGroup(title, description, groups, body)?.cs ?? null;
}

/**
 * The catalogue entry named anywhere in a report - title, feed description, or
 * the fetched article.
 *
 * The body is the important part. Matching used to see only the title and the
 * feed description, so a report headlined "QuickFox Supply Chain Attack
 * Delivers FDMTP Backdoor" went unattributed even though the article named
 * TWILL TYPHOON, which the catalogue already lists as an alias of MUSTANG
 * PANDA. The alias list was right; nothing ever read the text containing it.
 */
export function matchAdversaryGroup(
  title: string,
  description: string | null | undefined,
  groups: GroupEntry[],
  body?: string | null,
): GroupEntry | null {
  const haystack = `${title} ${description ?? ""} ${body ?? ""}`.toLowerCase();
  return matchGroup(haystack, groups);
}

/**
 * The stored/display adversary label for an item attributed to `nexus`: the
 * specific CrowdStrike cryptonym or a name from the item, otherwise a
 * "UNID <animal>" fallback (country-specific for Rest of the World). Returns
 * null for unattributed items (no nexus), which carry no label.
 */
export function computeAdversaryLabel(
  crowdstrikeAdversary: string | null | undefined,
  nexus: Nexus | null,
  title: string,
  description: string | null | undefined,
  groups: GroupEntry[],
  /** The fetched article, when there is one. */
  body?: string | null,
  /** The country about to be stored on the row, when one is known. */
  country?: string | null,
): string | null {
  const matched = matchAdversaryGroup(title, description, groups, body);
  // A catalogue hit carries its own nexus, so a report naming a known actor is
  // attributed even when the model offered no nexus of its own. Without this,
  // recognising the actor in the body still yielded nothing.
  const effectiveNexus = nexus ?? matched?.nexus ?? null;
  if (!effectiveNexus) return null;
  const specific = crowdstrikeAdversary ?? matched?.cs ?? null;
  return adversaryLabel(
    specific,
    effectiveNexus,
    `${title} ${description ?? ""} ${body ?? ""}`,
    country,
  );
}

export function isMarketing(c: RawCandidate): boolean {
  return MARKETING_RE.test(c.title) || MARKETING_RE.test(c.description ?? "");
}

export function isLargeScaleEcrime(c: RawCandidate): boolean {
  return LARGE_SCALE_RE.test(haystack(c));
}

const HACKTIVISM_RE = /\bhacktivis(?:m|t|ts)\b/i;

/** True when text reads as hacktivism (independent of a named collective). */
export function hasHacktivismKeyword(text: string): boolean {
  return HACKTIVISM_RE.test(text);
}

// A vulnerability advisory / bulletin: the subject (title) is about a
// vulnerability, e.g. "2026-007: Critical Vulnerability in Windows Netlogon",
// "Multiple vulnerabilities in Ivanti Sentry", or French "Vulnerabilite dans
// ...". Matched on the title only (the subject), so a research post that merely
// mentions a vulnerability in its body is not swept up.
const VULN_ADVISORY_RE = /\bvulnerabilit(?:y|ies|es?)\b/i;

/** True when the title reads as a vulnerability advisory/bulletin. */
export function isVulnAdvisory(title: string): boolean {
  return VULN_ADVISORY_RE.test(title);
}

export function classifyItemType(
  c: RawCandidate,
  group: GroupEntry | null,
): ItemType {
  const hay = haystack(c);
  if (CVE_RE.test(hay)) return "vuln";
  // Any item attributed to a named catalogue actor is that actor's activity, so
  // it belongs in the actor cards (research) - nation-state, eCrime and
  // hacktivism alike, incident or analysis. Only *unattributed* breach/leak
  // disclosures fall through to the Breaches list.
  if (group) return "actor_activity";
  if (BREACH_RE.test(hay)) return "breach";
  // News-category, high-signal items become breaking headlines.
  if (c.sourceCategory === "news" && (BREACH_RE.test(hay) || LARGE_SCALE_RE.test(hay)))
    return "breaking";
  return "report";
}

export function classifyConfidence(c: RawCandidate): Confidence {
  return classifyExploitStatus(haystack(c), c.sourceCategory);
}

/**
 * The exploit status shown in the Exploits section, derived deterministically
 * from the report text (not the enricher's `confidence` - the LLM does not map
 * "a PoC was released" onto "poc" reliably): a mentioned proof-of-concept /
 * exploit code -> "poc"; a government advisory or confirmed/patched/exploited
 * language -> "confirmed"; otherwise "suspected".
 */
export function classifyExploitStatus(
  text: string,
  sourceCategory?: string | null,
): Confidence {
  const hay = text.toLowerCase();
  if (POC_RE.test(hay)) return "poc";
  if (sourceCategory === "government" || CONFIRMED_RE.test(hay))
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
    // The deterministic rules do not assign taxonomy labels; only the LLM does.
    labels: [],
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
  | { kind: "drop"; reason: string }
  | { kind: "unsure" };

export function rulesClassify(
  c: RawCandidate,
  groups: GroupEntry[],
): RulesVerdict {
  if (!c.title || !c.url) return { kind: "drop", reason: "missing title or URL" };
  if (isMarketing(c)) return { kind: "drop", reason: "marketing / product" };

  const hay = haystack(c);
  const group = matchGroup(hay, groups);
  const isHacktivistGroup = group?.motivation === "hacktivism";
  // A post naming an eCrime crew is kept whenever it carries any substance - a
  // breach/leak/ransomware incident, a large-scale campaign, or analysis. Only a
  // bare crew mention with none of those signals is dropped, so we never drop
  // actual ransomware-group activity. Hacktivist collectives are exempt: their
  // activity is tracked intelligence, kept below.
  if (
    group?.nexus === "other" &&
    !isHacktivistGroup &&
    !isLargeScaleEcrime(c) &&
    !RESEARCH_RE.test(hay) &&
    !ECRIME_INCIDENT_RE.test(hay)
  )
    return { kind: "drop", reason: "low-signal crew mention" };

  const itemType = classifyItemType(c, group);
  // Hacktivist activity (named collective from the catalogue, or explicit
  // hacktivism wording) is genuine intelligence - keep it rather than letting it
  // fall into the ambiguous news bucket where it could be dropped.
  if (isHacktivistGroup || hasHacktivismKeyword(hay)) {
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
   * @param groups adversary aliases built from the `adversaries` catalogue (see
   * buildGroupsFromAdversaries) - the single source of actor identification.
   * Sorted longest-alias-first so specific names beat generic ones.
   */
  constructor(groups: GroupEntry[] = []) {
    this.groups = sortGroups(groups);
  }

  async enrich(c: RawCandidate): Promise<EnrichedItem | null> {
    const v = rulesClassify(c, this.groups);
    return v.kind === "keep" ? v.item : null;
  }
}
