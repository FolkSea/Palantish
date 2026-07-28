// Best-effort extraction of indicators of compromise (IOCs) and MITRE ATT&CK
// technique ids from a report's text. Pure and regex-based - no LLM - so it
// only surfaces indicators that literally appear in the title/description.

export type FileIoc = {
  sha1: string | null;
  name: string | null;
  comment: string | null;
};

export type Indicators = {
  ips: string[];
  domains: string[];
  uris: string[];
  files: FileIoc[];
  mitre: string[];
};

// File extensions that mark a token as a filename rather than a domain.
const FILE_EXT =
  "exe|dll|sys|ps1|bat|cmd|vbs|js|jse|wsf|hta|scr|lnk|jar|apk|dmg|iso|img|bin|msi|doc|docx|xls|xlsx|ppt|pptx|pdf|rtf|zip|rar|7z|gz|tar|py|sh|elf|so|tmp|dat|macho";

const URI_RE = /\bhttps?:\/\/[^\s"'<>()\]]+/gi;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b/gi;
const SHA1_RE = /\b[a-f0-9]{40}\b/gi;
const FILE_RE = new RegExp(`\\b[\\w-]{1,64}\\.(?:${FILE_EXT})\\b`, "gi");
const EXT_ONLY_RE = new RegExp(`^(?:${FILE_EXT})$`, "i");
const MITRE_RE = /\bT\d{4}(?:\.\d{3})?\b/g;

/** Normalise common defanged forms (1.2.3[.]4, hxxp://, example[dot]com). */
function defang(text: string): string {
  return text
    .replace(/\[\.\]|\(\.\)|\{\.\}|\[dot\]/gi, ".")
    .replace(/\[:\]/g, ":")
    .replace(/\[\/\]/g, "/")
    .replace(/\bhxxp(s?)\b/gi, "http$1");
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

export function extractIndicators(text: string): Indicators {
  const t = defang(text ?? "");

  const uris = uniq(matchAll(t, URI_RE));
  const ips = uniq(matchAll(t, IPV4_RE).filter(validIpv4));
  const ipSet = new Set(ips);
  const uriHosts = new Set(uris.map(hostOf));

  const domains = uniq(
    matchAll(t, DOMAIN_RE)
      .map((d) => d.toLowerCase())
      .filter((d) => !ipSet.has(d) && !isFileExt(d) && !uriHosts.has(d)),
  );

  const sha1s = uniq(matchAll(t, SHA1_RE).map((h) => h.toLowerCase()));
  const fileNames = uniq(matchAll(t, FILE_RE));
  const files: FileIoc[] = [
    ...sha1s.map((sha1) => ({ sha1, name: null, comment: null })),
    ...fileNames.map((name) => ({ sha1: null, name, comment: null })),
  ];

  const mitre = uniq(matchAll(t, MITRE_RE).map((m) => m.toUpperCase()));

  return { ips, domains, uris, files, mitre };
}

/** Total number of indicators found (for badges / empty-state checks). */
export function indicatorCount(i: Indicators): number {
  return i.ips.length + i.domains.length + i.uris.length + i.files.length;
}
