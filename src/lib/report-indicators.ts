// Best-effort extraction of indicators of compromise (IOCs) and MITRE ATT&CK
// technique ids from a report's text. Pure and regex-based - no LLM - so it
// only surfaces indicators that literally appear in the title/description.

export type Indicators = {
  ips: string[];
  domains: string[];
  uris: string[];
  files: string[]; // file hashes (MD5 / SHA1 / SHA256)
  cves: string[]; // CVE identifiers (CVE-YYYY-NNNN)
  mitre: string[];
};

// File extensions that mark a token as a filename rather than a domain.
const FILE_EXT =
  "exe|dll|sys|ps1|bat|cmd|vbs|js|jse|wsf|hta|scr|lnk|jar|apk|dmg|iso|img|bin|msi|doc|docx|xls|xlsx|ppt|pptx|pdf|rtf|zip|rar|7z|gz|tar|py|sh|elf|so|tmp|dat|macho";

const URI_RE = /\bhttps?:\/\/[^\s"'<>()\]]+/gi;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b/gi;
// Match SHA256 (64) / SHA1 (40) / MD5 (32) hex hashes, longest first.
const HASH_RE = /\b(?:[a-f0-9]{64}|[a-f0-9]{40}|[a-f0-9]{32})\b/gi;
const EXT_ONLY_RE = new RegExp(`^(?:${FILE_EXT})$`, "i");
const MITRE_RE = /\bT\d{4}(?:\.\d{3})?\b/g;
const CVE_RE = /\bCVE-\d{4}-\d{4,7}\b/gi;

/** Normalise common defanged forms (1.2.3[.]4, hxxp://, example[dot]com). */
function defang(text: string): string {
  return text
    .replace(/\[\.\]|\(\.\)|\{\.\}|\[dot\]/gi, ".")
    .replace(/\[:\]/g, ":")
    .replace(/\[\/\]/g, "/")
    .replace(/\bhxxp(s?)\b/gi, "http$1");
}

/**
 * Normalise a single indicator to the same (non-defanged) form that
 * extractIndicators stores, so a search query matches whether the user typed it
 * fanged or defanged.
 */
export function normalizeIndicator(value: string): string {
  return defang(value ?? "").trim();
}

function uniq(arr: string[]): string[] {
  return [...new Set(arr)];
}
function matchAll(text: string, re: RegExp): string[] {
  return text.match(re) ?? [];
}
function validIpv4(ip: string): boolean {
  const parts = ip.split(".");
  return (
    parts.length === 4 &&
    parts.every((p) => {
      const n = Number(p);
      return p !== "" && n >= 0 && n <= 255 && String(n) === p;
    })
  );
}

/**
 * IPv4 addresses that are never a reportable IOC: unspecified (0/8), private
 * (10/8, 172.16/12, 192.168/16), loopback (127/8), CGNAT (100.64/10), link-local
 * (169.254/16), and multicast / reserved / broadcast (>= 224). These are dropped
 * in-code, so the allowlist table only needs specific public IPs. Documentation
 * ranges (192.0.2/24, ...) are left alone - they read as example addresses that
 * a reviewer may still want to see, and belong in the allowlist if unwanted.
 */
export function isNonRoutableIp(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    return false;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a >= 224) return true; // multicast (224/4), reserved (240/4), broadcast
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}
function isFileExt(domain: string): boolean {
  return EXT_ONLY_RE.test(domain.split(".").pop() ?? "");
}
function hostOf(uri: string): string {
  try {
    return new URL(uri).hostname.toLowerCase();
  } catch {
    return "";
  }
}

// Web/social/blog-chrome domains that appear on report pages but are never the
// reported infrastructure. The report's own source domain is excluded too (see
// the excludeDomains argument), so a blog's own domain is not treated as an IOC.
const BENIGN_DOMAINS = [
  "twitter.com", "x.com", "linkedin.com", "facebook.com", "fb.com",
  "instagram.com", "youtube.com", "youtu.be", "reddit.com", "pinterest.com",
  "tiktok.com", "flipboard.com", "whatsapp.com",
  "w3.org", "schema.org", "creativecommons.org", "gravatar.com", "gmpg.org",
  "google-analytics.com", "googletagmanager.com", "doubleclick.net", "feedburner.com",
];

// Registrar / managed-DNS nameserver / domain-parking hosts that turn up in IOC
// appendices (registrar of record, nameservers, WHOIS/abuse contacts) but are
// infrastructure, not the reported IOC. Nameserver zones (e.g. ns.cloudflare.com)
// are listed rather than the parent so real domains on the same provider survive.
const INFRA_DOMAINS = [
  // registrars
  "publicdomainregistry.com", "godaddy.com", "namecheap.com", "namesilo.com",
  "name.com", "enom.com", "tucows.com", "gandi.net", "ovh.com", "ovh.net",
  "dynadot.com", "porkbun.com", "networksolutions.com", "register.com",
  "namebright.com", "internetbs.net", "nicenic.net", "regery.com",
  "hostinger.com", "ionos.com", "west.cn", "22.cn", "eranet.com",
  // managed-DNS nameserver zones
  "ns.cloudflare.com", "domaincontrol.com", "registrar-servers.com",
  "azure-dns.com", "azure-dns.net", "azure-dns.org", "azure-dns.info",
  "googledomains.com", "dnsmadeeasy.com", "nsone.net", "dnspod.net",
  // domain parking
  "sedoparking.com", "bodis.com", "afternic.com", "parkingcrew.net", "above.com",
];

const STATIC_EXCLUDED = new Set<string>([...BENIGN_DOMAINS, ...INFRA_DOMAINS]);

/** The www-stripped hostname of a URL, for building the exclusion set. */
export function sourceDomain(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** True if `domain` equals, or is a subdomain of, any domain in `excluded`. */
function isExcludedDomain(domain: string, excluded: Set<string>): boolean {
  let d = domain;
  for (;;) {
    if (excluded.has(d)) return true;
    const dot = d.indexOf(".");
    if (dot < 0) return false;
    d = d.slice(dot + 1);
  }
}

/**
 * Whether a domain should be dropped as non-IOC: the built-in benign / registrar
 * / DNS-infrastructure list, plus any `extra` domains (e.g. the report's source
 * domain and the known blog catalogue). Exported for the IOC-domain backfill.
 */
export function shouldExcludeDomain(
  domain: string,
  extra?: Iterable<string>,
): boolean {
  if (!domain) return false;
  let excluded = STATIC_EXCLUDED;
  if (extra) {
    excluded = new Set(STATIC_EXCLUDED);
    for (const d of extra) {
      const v = d.toLowerCase().trim();
      if (v) excluded.add(v);
    }
  }
  return isExcludedDomain(domain.toLowerCase(), excluded);
}

/**
 * Whether an IP should be dropped as non-IOC: the built-in non-routable ranges
 * (loopback / private / link-local / documentation / ...) plus any `extra`
 * allowlisted public IPs. Exported for the IOC prune script.
 */
export function shouldExcludeIp(ip: string, extra?: Iterable<string>): boolean {
  const v = (ip ?? "").trim();
  if (!v) return false;
  if (isNonRoutableIp(v)) return true;
  if (extra) for (const e of extra) if ((e ?? "").trim() === v) return true;
  return false;
}

/**
 * Extract indicators from text. `excludeDomains` (plus a built-in benign list)
 * are dropped from the domain and URI results - pass the report's own source
 * domain and the known blog/source domains so site chrome is not mistaken for
 * an IOC. `excludeIps` drops specific allowlisted public IPs; non-routable IPs
 * (loopback, private, ...) are always dropped.
 */
export function extractIndicators(
  text: string,
  excludeDomains?: Iterable<string>,
  excludeIps?: Iterable<string>,
): Indicators {
  const t = defang(text ?? "");

  const excluded = new Set<string>(STATIC_EXCLUDED);
  if (excludeDomains) {
    for (const d of excludeDomains) {
      const v = d.toLowerCase().trim();
      if (v) excluded.add(v);
    }
  }
  const ipExcluded = new Set<string>();
  if (excludeIps) {
    for (const ip of excludeIps) {
      const v = (ip ?? "").trim();
      if (v) ipExcluded.add(v);
    }
  }

  const uris = uniq(matchAll(t, URI_RE)).filter(
    (u) => !isExcludedDomain(hostOf(u), excluded),
  );
  const ips = uniq(matchAll(t, IPV4_RE).filter(validIpv4)).filter(
    (ip) => !isNonRoutableIp(ip) && !ipExcluded.has(ip),
  );
  const ipSet = new Set(ips);
  const uriHosts = new Set(uris.map(hostOf));

  const domains = uniq(
    matchAll(t, DOMAIN_RE)
      .map((d) => d.toLowerCase())
      .filter(
        (d) =>
          !ipSet.has(d) &&
          !isFileExt(d) &&
          !uriHosts.has(d) &&
          !isExcludedDomain(d, excluded),
      ),
  );

  const files = uniq(matchAll(t, HASH_RE).map((h) => h.toLowerCase()));

  const cves = uniq(matchAll(t, CVE_RE).map((c) => c.toUpperCase()));

  const mitre = uniq(matchAll(t, MITRE_RE).map((m) => m.toUpperCase()));

  return { ips, domains, uris, files, cves, mitre };
}

/** Total number of indicators found (for badges / empty-state checks). */
export function indicatorCount(i: Indicators): number {
  return (
    i.ips.length +
    i.domains.length +
    i.uris.length +
    i.files.length +
    i.cves.length
  );
}

// Full-string validators for editing an indicator by type.
const DOMAIN_FULL_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;
const URI_FULL_RE = /^https?:\/\/[^\s]+$/i;
const HASH_FULL_RE = /^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})$/i;
const CVE_FULL_RE = /^CVE-\d{4}-\d{4,7}$/i;
const MITRE_FULL_RE = /^T\d{4}(?:\.\d{3})?$/i;

/** Whether `value` is a valid indicator of the given ioc_type. */
export function validIndicator(value: string, type: string): boolean {
  const v = value.trim();
  if (!v) return false;
  switch (type) {
    case "ip":
      return validIpv4(v);
    case "domain":
      return DOMAIN_FULL_RE.test(v);
    case "uri":
      return URI_FULL_RE.test(v);
    case "file_hash":
      return HASH_FULL_RE.test(v);
    case "cve":
      return CVE_FULL_RE.test(v);
    case "mitre":
      return MITRE_FULL_RE.test(v);
    default:
      return true;
  }
}

/** Normalise an indicator value to how it is stored (lowercase domains/hashes,
 * uppercase CVE/MITRE ids; IPs and URIs are kept as typed). */
export function normalizeIndicatorValue(value: string, type: string): string {
  const v = value.trim();
  if (type === "domain" || type === "file_hash") return v.toLowerCase();
  if (type === "cve" || type === "mitre") return v.toUpperCase();
  return v;
}
