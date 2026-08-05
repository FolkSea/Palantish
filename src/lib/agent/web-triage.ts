// Web-fetch triage: builds the Messages API request that has Claude fetch and
// analyse a report URL with the server-side web_fetch tool, and parses the
// response. Pure/dependency-light (no network) so it is unit-tested directly;
// AnalystAgent.triageWithFetch drives it against the live client.
import type { Nexus, Confidence } from "@/lib/badges";
import type { ItemType } from "@/lib/ingest/types";
import { parseLabels } from "./labels";

export type FetchStatus = "full" | "feed_only" | "failed";
export type DashboardKind = "research" | "breach" | "exploit" | "other";

export type LlmIndicators = {
  ipv4: string[];
  ipv6: string[];
  domains: string[];
  urls: string[];
  fileHashes: string[];
  cves: string[];
};

export type IndicatorEvidence = { value: string; excerpt: string };

/** What AnalystAgent.triageWithFetch returns: the parsed classification plus the
 * code-derived fetch outcome (fetchStatus reflects the real tool result). */
export type WebTriageOutcome = {
  parsed: WebTriageResult | null;
  fetchStatus: FetchStatus;
  fetchedText: string | null;
  fetchedUrl: string | null;
};

export type WebTriageResult = {
  relevant: boolean;
  fetchStatus: FetchStatus;
  nexus: Nexus | null;
  itemType: ItemType;
  dashboardKind: DashboardKind;
  confidence: Confidence;
  crowdstrikeAdversary: string | null;
  labels: string[];
  indicators: LlmIndicators;
  mitreTechniques: string[];
  summary: string;
  reason: string | null;
  evidence: IndicatorEvidence[];
};

const NEXUS_VALUES: Nexus[] = [
  "china",
  "russia",
  "north_korea",
  "iran",
  "rest_of_world",
  "other",
];
const ITEM_TYPES: ItemType[] = [
  "actor_activity",
  "breach",
  "vuln",
  "report",
  "breaking",
];
const DASHBOARD_KINDS: DashboardKind[] = ["research", "breach", "exploit", "other"];
const CONFIDENCE_VALUES: Confidence[] = ["confirmed", "suspected", "poc"];

// Models with the dynamic-filtering web fetch tool; older ones use the basic
// variant. Both accept max_uses / allowed_domains / max_content_tokens.
const ENHANCED_FETCH_RE =
  /^claude-(opus-(5|4-8|4-7|4-6)|sonnet-(5|4-6)|fable-5|mythos-5)/;

/** The web_fetch tool `type` for a model (enhanced vs basic variant). */
export function webFetchToolType(model: string): string {
  return ENHANCED_FETCH_RE.test(model)
    ? "web_fetch_20260209"
    : "web_fetch_20250910";
}

/** The web_fetch tool definition, bounded to the report's host and a content
 * cap so an unexpectedly large page or PDF cannot consume unbounded tokens. */
export function webFetchTool(
  model: string,
  opts: { allowedDomains: string[]; maxContentTokens: number },
) {
  return {
    type: webFetchToolType(model),
    name: "web_fetch",
    max_uses: 2,
    allowed_domains: opts.allowedDomains,
    max_content_tokens: opts.maxContentTokens,
  };
}

/** Host (and its www. / bare pair) of a URL, for the web_fetch allowlist. */
export function allowedDomainsFor(rawUrl: string): string[] {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    const bare = host.replace(/^www\./, "");
    return [...new Set([host, bare, `www.${bare}`])];
  } catch {
    return [];
  }
}

export const WEB_TRIAGE_INSTRUCTIONS = `You triage an open-source cyber report for a nation-state/eCrime intelligence dashboard.

STEP 1 - RETRIEVE: Call the web_fetch tool on the exact report URL given below before doing anything else. Analyse the fetched article, not just the feed title/description. If web_fetch fails or returns no usable content, fall back to the feed title and description and set fetchStatus to "feed_only".

STEP 2 - CLASSIFY and EXTRACT, then return ONLY strict JSON of this exact shape (no prose, no markdown fence):
{
  "relevant": boolean,
  "fetchStatus": "full" | "feed_only" | "failed",
  "nexus": "china" | "russia" | "north_korea" | "iran" | "rest_of_world" | "other" | null,
  "itemType": "actor_activity" | "breach" | "vuln" | "report" | "breaking",
  "dashboardKind": "research" | "breach" | "exploit" | "other",
  "confidence": "confirmed" | "suspected" | "poc",
  "crowdstrikeAdversary": string | null,
  "labels": { "malware": string[], "adversary": string[], "target": string[], "vector": string[], "ai": string[] },
  "indicators": {
    "ipv4": string[], "ipv6": string[], "domains": string[], "urls": string[], "fileHashes": string[], "cves": string[]
  },
  "mitreTechniques": string[],
  "summary": string,
  "reason": string | null,
  "evidence": [ { "value": string, "excerpt": string } ]
}

RULES:
- relevant=false for marketing, product news, vendor self-promotion, roundups, opinion, or anything that is not genuine threat intelligence; put a short "reason" when you drop.
- fetchStatus must reflect what actually happened: "full" only when web_fetch returned the article body; "feed_only" when you fell back to the feed; "failed" when you could not classify at all.
- nexus: attributed nation-state, "rest_of_world" for another nation-state, "other" for eCrime/hacktivism, else null. crowdstrikeAdversary is the public CrowdStrike cryptonym when one clearly applies, else null. Report the group even when the article names it under another vendor's alias (Twill Typhoon, Earth Preta and Bronze President are all MUSTANG PANDA); if you are unsure of the cryptonym, give the name the article uses rather than null, and never put a victim or product here.
- dashboardKind: "exploit" for a CVE/advisory/PoC, "breach" for an unattributed breach/leak/extortion, "research" for named-actor activity or analysis, else "other".
- labels: short bare names per category, reusing an exact label from the memory brief's "Known labels" list when one matches. The categories are not interchangeable:
  - adversary: ONLY the attacker - a threat group, crew or state-sponsored actor. Never a victim, never a compromised product, never a vendor.
  - target: who or what was attacked - the victim organisation or sector, and the software, service or device that was compromised or abused to reach them.
  - vector: how the attack was delivered, from this closed list ONLY, and only when the report is clearly about it: SupplyChain (the attacker compromised a legitimate product, update, installer, package or dependency to reach its users). Omit the category entirely when none applies.
  - malware: named malware families, tools and backdoors. ai: AI products or models involved.
  In a supply-chain report the compromised product is the TARGET and the vector is SupplyChain; the adversary is the group behind it, or no adversary label at all when the report names none. A report titled "QuickFox Supply Chain Attack Delivers FDMTP Backdoor via Trojanized Windows Installer" yields target QuickFox, vector SupplyChain, malware FDMTP - and adversary only if the article names the group.
- indicators: return ONLY indicators that appear verbatim in the fetched report. Do NOT infer, guess, complete, or invent any value. IPv4/IPv6/domains/urls/fileHashes(MD5/SHA1/SHA256)/cves(CVE-YYYY-NNNN). For each indicator you return, add an { value, excerpt } entry to "evidence" quoting the surrounding text from the report so the value can be verified. If you did not fetch the report, return empty indicator arrays.
- mitreTechniques: ATT&CK technique ids (T1059, T1059.003) explicitly named in the report.
- summary: 1-3 plain ASCII sentences of the report's substance.`;

/** Build the user message: the candidate context plus the URL to fetch. */
export function buildTriageUserMessage(c: {
  url: string;
  sourceName: string;
  sourceCategory?: string | null;
  title: string;
  description?: string | null;
}): string {
  return [
    `Report URL (fetch this with web_fetch): ${c.url}`,
    `Source: ${c.sourceName} (${c.sourceCategory ?? "unknown"})`,
    `RSS title: ${c.title}`,
    `RSS description: ${c.description ?? ""}`,
    ``,
    `Fetch the URL, then return the strict JSON.`,
  ].join("\n");
}

type Block = {
  type: string;
  name?: string;
  text?: string;
  input?: { url?: string } | null;
  content?: unknown;
};

// A web_fetch that returns only a consent/challenge stub is technically a
// "result" but is not the article. Require a plausible body before calling the
// retrieval full, so those reports fall back and are flagged for review.
export const MIN_FETCHED_BODY_CHARS = 600;

/**
 * Inspect the response content blocks to determine - from the actual web_fetch
 * tool result, never the model's claim - whether the fetch succeeded, which URL
 * it fetched, and the retrieved document text (for deterministic reconciliation).
 */
export function parseFetchOutcome(content: Block[]): {
  fetchedUrl: string | null;
  succeeded: boolean;
  text: string | null;
  errorCode: string | null;
} {
  let fetchedUrl: string | null = null;
  let succeeded = false;
  let text: string | null = null;
  let errorCode: string | null = null;

  for (const b of content ?? []) {
    if (b.type === "server_tool_use" && b.name === "web_fetch") {
      fetchedUrl = b.input?.url ?? fetchedUrl;
    }
    if (b.type === "web_fetch_tool_result") {
      const c = b.content as
        | {
            type?: string;
            error_code?: string;
            content?: { source?: { data?: string } };
          }
        | undefined;
      if (c?.type === "web_fetch_result") {
        const data = c.content?.source?.data;
        if (typeof data === "string" && data.length > 0) {
          // Keep the longest body across rounds (the tool may fetch twice).
          if (!text || data.length > text.length) text = data;
        }
        // Only a plausible article body counts as a successful retrieval.
        if ((text?.length ?? 0) >= MIN_FETCHED_BODY_CHARS) succeeded = true;
      } else {
        errorCode = c?.error_code ?? "web_fetch_error";
      }
    }
  }
  return { fetchedUrl, succeeded, text, errorCode };
}

export function textOfBlocks(content: Block[]): string {
  return (content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function parseIndicators(v: unknown): LlmIndicators {
  const o = (typeof v === "object" && v ? v : {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string[] => {
    for (const k of keys) if (o[k] !== undefined) return strArray(o[k]);
    return [];
  };
  return {
    ipv4: pick("ipv4", "ips", "ip"),
    ipv6: pick("ipv6"),
    domains: pick("domains", "domain"),
    urls: pick("urls", "uris", "uri"),
    fileHashes: pick("fileHashes", "file_hashes", "hashes", "files"),
    cves: pick("cves", "cve"),
  };
}

function parseEvidence(v: unknown): IndicatorEvidence[] {
  if (!Array.isArray(v)) return [];
  const out: IndicatorEvidence[] = [];
  for (const e of v) {
    if (typeof e !== "object" || e === null) continue;
    const r = e as Record<string, unknown>;
    const value = typeof r.value === "string" ? r.value : "";
    const excerpt = typeof r.excerpt === "string" ? r.excerpt : "";
    if (value) out.push({ value, excerpt });
  }
  return out;
}

/**
 * Parse the model's strict-JSON triage output (tolerant of surrounding prose).
 * Returns null when nothing parseable is present; otherwise every field is
 * validated to its allowed set with safe fallbacks.
 */
export function parseWebTriage(text: string): WebTriageResult | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;

  const nexus =
    typeof o.nexus === "string" && NEXUS_VALUES.includes(o.nexus as Nexus)
      ? (o.nexus as Nexus)
      : null;
  const itemType = ITEM_TYPES.includes(o.itemType as ItemType)
    ? (o.itemType as ItemType)
    : "report";
  const dashboardKind = DASHBOARD_KINDS.includes(o.dashboardKind as DashboardKind)
    ? (o.dashboardKind as DashboardKind)
    : "other";
  const confidence = CONFIDENCE_VALUES.includes(o.confidence as Confidence)
    ? (o.confidence as Confidence)
    : "suspected";
  const fetchStatus: FetchStatus =
    o.fetchStatus === "full" || o.fetchStatus === "feed_only"
      ? o.fetchStatus
      : "failed";

  return {
    relevant: Boolean(o.relevant),
    fetchStatus,
    nexus,
    itemType,
    dashboardKind,
    confidence,
    crowdstrikeAdversary:
      typeof o.crowdstrikeAdversary === "string" && o.crowdstrikeAdversary
        ? o.crowdstrikeAdversary
        : null,
    labels: parseLabels(o.labels),
    indicators: parseIndicators(o.indicators),
    mitreTechniques: strArray(o.mitreTechniques).map((m) => m.toUpperCase()),
    summary: typeof o.summary === "string" ? o.summary.trim() : "",
    reason: typeof o.reason === "string" && o.reason.trim() ? o.reason.trim() : null,
    evidence: parseEvidence(o.evidence),
  };
}
