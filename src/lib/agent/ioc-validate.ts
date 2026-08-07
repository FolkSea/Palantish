// Validate and reconcile the LLM's structured IOC output before persistence.
// Pure (no server/DB imports) so it is unit-tested directly. The LLM is never
// trusted for syntax or presence: every value is refanged, validated, stripped
// of source/allow-listed infrastructure, checked against the fetched page text
// (to reject hallucinations), and reconciled with a deterministic extraction of
// that same text so nothing the model missed is dropped.
import {
  extractIndicators,
  normalizeIndicator,
  normalizeIndicatorValue,
  validIndicator,
  isNonRoutableIp,
  isNonRoutableIpv6,
  isIpv4Indicator,
  shouldExcludeDomain,
  shouldExcludeIp,
  isFilenameOrCode,
} from "@/lib/report-indicators";
import type { IocRow } from "@/lib/ingest/iocs";
import type { LlmIndicators } from "./web-triage";

const MITRE_FULL_RE = /^T\d{4}(?:\.\d{3})?$/i;

function hostOf(uri: string): string {
  try {
    return new URL(uri).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

type Excludes = {
  excludeDomains?: Iterable<string>;
  excludeIps?: Iterable<string>;
};

/** Whether an already-normalised value should be dropped as excluded infra. */
function isExcluded(type: string, value: string, ex: Excludes): boolean {
  if (type === "domain") {
    // The same filename/code-identifier rejection the text extractor applies.
    // Without it this path stored sharer.php, index.html and console.log as
    // domains - the model reports them in good faith, they simply are not.
    if (isFilenameOrCode(value)) return true;
    return shouldExcludeDomain(value, ex.excludeDomains);
  }
  if (type === "uri") {
    const h = hostOf(value);
    return !h || shouldExcludeDomain(h, ex.excludeDomains);
  }
  if (type === "ip") {
    if (isIpv4Indicator(value)) return shouldExcludeIp(value, ex.excludeIps);
    return isNonRoutableIpv6(value); // IPv6: drop loopback/link-local/ULA
  }
  return false;
}

/**
 * Reconcile the model's indicators with the fetched report text.
 *
 * `fetchedText` is the web-fetch document body. When present, an LLM value is
 * kept only if it also appears (refanged) in that text - this rejects
 * hallucinated indicators. Deterministic extraction of the same text is unioned
 * in so indicators the model omitted are still captured. When `fetchedText` is
 * null (no successful fetch), only the LLM values are validated (no presence
 * check is possible) - callers pass the model's indicators only for a confirmed
 * fetch, so this path is normally empty.
 */
export function reconcileIndicators(
  indicators: LlmIndicators,
  mitre: string[],
  fetchedText: string | null,
  ex: Excludes = {},
): IocRow[] {
  const out = new Map<string, IocRow>();
  const key = (type: string, value: string) => `${type}\t${value.toLowerCase()}`;
  const add = (type: string, value: string) => {
    if (!value) return;
    out.set(key(type, value), { value, ioc_type: type });
  };

  // Refanged, lowercased haystack for presence checks (null => skip the check).
  const haystack = fetchedText
    ? normalizeIndicator(fetchedText).toLowerCase()
    : null;
  const present = (value: string): boolean =>
    haystack === null ||
    haystack.includes(normalizeIndicator(value).toLowerCase());

  // 1) The model's indicators: refang -> normalise -> validate -> exclude ->
    //    confirm presence in the fetched text.
  const llm: [string, string[]][] = [
    ["ip", indicators.ipv4],
    ["ip", indicators.ipv6],
    ["domain", indicators.domains],
    ["file_hash", indicators.fileHashes],
    ["cve", indicators.cves],
  ];
  for (const [type, values] of llm) {
    for (const raw of values) {
      const v = normalizeIndicatorValue(normalizeIndicator(raw), type);
      if (!v || !validIndicator(v, type)) continue;
      if (type === "ip" && isIpv4Indicator(v) && isNonRoutableIp(v)) continue;
      if (isExcluded(type, v, ex)) continue;
      if (!present(v)) continue; // reject values not in the source
      add(type, v);
    }
  }
  for (const raw of mitre) {
    const v = raw.trim().toUpperCase();
    if (!MITRE_FULL_RE.test(v)) continue;
    if (!present(v)) continue;
    add("mitre", v);
  }

  // 2) Deterministic reconciliation: extract from the fetched text and union in.
  // web_fetch returns full-page markdown, where site chrome (nav, ads, images)
  // arrives as [text](url) / ![alt](url) links - strip the link targets first so
  // chrome URLs are not extracted as IOCs. Prose indicators (plain or defanged)
  // survive, and linked IOCs the model judged real are already kept by step 1.
  if (fetchedText) {
    const detText = fetchedText.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
    const det = extractIndicators(detText, ex.excludeDomains, ex.excludeIps);
    for (const v of det.ips) add("ip", v);
    for (const v of det.domains) add("domain", v);
    for (const v of det.files) add("file_hash", v);
    for (const v of det.cves) add("cve", v);
    for (const v of det.mitre) add("mitre", v);
  }

  return [...out.values()];
}
