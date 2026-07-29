import { describe, it, expect } from "vitest";
import {
  extractIndicators,
  normalizeIndicator,
  validIndicator,
  normalizeIndicatorValue,
} from "@/lib/report-indicators";

describe("extractIndicators", () => {
  it("extracts IPs, domains, URIs, hashes and MITRE ids", () => {
    const text =
      "The actor used T1059.003 and T1566 to drop payload.exe (sha1 " +
      "da39a3ee5e6b4b0d3255bfef95601890afd80709). C2 at http://evil.example.com/beacon " +
      "and 203.0.113.42, plus the domain updates.malwarehost.net.";
    const i = extractIndicators(text);
    expect(i.ips).toContain("203.0.113.42");
    expect(i.uris).toContain("http://evil.example.com/beacon");
    expect(i.domains).toContain("updates.malwarehost.net");
    expect(i.mitre.sort()).toEqual(["T1059.003", "T1566"]);
    expect(i.files).toContain("da39a3ee5e6b4b0d3255bfef95601890afd80709");
  });

  it("extracts CVE identifiers (uppercased, deduped)", () => {
    const i = extractIndicators(
      "Exploits cve-2026-1234 and CVE-2026-1234; also CVE-2025-98765. Not TCVE-2026-1.",
    );
    expect(i.cves.sort()).toEqual(["CVE-2025-98765", "CVE-2026-1234"]);
  });

  it("captures MD5, SHA1 and SHA256 hashes (and only the hash)", () => {
    const md5 = "d41d8cd98f00b204e9800998ecf8427e";
    const sha1 = "da39a3ee5e6b4b0d3255bfef95601890afd80709";
    const sha256 =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const i = extractIndicators(`hashes: ${md5} ${sha1} ${sha256} for evil.dll`);
    expect(i.files.sort()).toEqual([md5, sha1, sha256].sort());
  });

  it("returns defanged indicators to their original format", () => {
    const i = extractIndicators("beacon to 8.8.8[.]8 via hxxps://bad[.]tld/x");
    expect(i.ips).toContain("8.8.8.8");
    expect(i.uris).toContain("https://bad.tld/x");
  });

  it("refangs a bare defanged domain", () => {
    const i = extractIndicators("payload beacons to updates[.]malwarehost[.]net");
    expect(i.domains).toContain("updates.malwarehost.net");
  });

  it("does not treat a filename as a domain, or an invalid IP", () => {
    const i = extractIndicators("dropped mimikatz.dll; ignore 999.1.1.1");
    expect(i.domains).not.toContain("mimikatz.dll");
    expect(i.ips).not.toContain("999.1.1.1");
  });

  it("excludes benign web/social domains and the given source domains", () => {
    const text =
      "Follow us on twitter.com. Reported by securelist.com. " +
      "C2 at updates.malwarehost.net and cdn.securelist.com/x.";
    const i = extractIndicators(text, ["securelist.com"]);
    expect(i.domains).toContain("updates.malwarehost.net");
    expect(i.domains).not.toContain("twitter.com");
    expect(i.domains).not.toContain("securelist.com");
    // subdomains of an excluded domain are excluded too
    expect(i.domains).not.toContain("cdn.securelist.com");
  });

  it("drops URIs hosted on an excluded/benign domain", () => {
    const i = extractIndicators(
      "share https://twitter.com/intent/tweet and payload https://evil.example.com/a",
      ["blog.example.org"],
    );
    expect(i.uris).toContain("https://evil.example.com/a");
    expect(i.uris.some((u) => u.includes("twitter.com"))).toBe(false);
  });

  it("returns empty sets when nothing is present", () => {
    const i = extractIndicators("A generic advisory with no indicators.");
    expect(i.ips).toHaveLength(0);
    expect(i.domains).toHaveLength(0);
    expect(i.uris).toHaveLength(0);
    expect(i.files).toHaveLength(0);
    expect(i.cves).toHaveLength(0);
    expect(i.mitre).toHaveLength(0);
  });
});

describe("validIndicator", () => {
  it("validates each type and rejects malformed values", () => {
    expect(validIndicator("8.8.8.8", "ip")).toBe(true);
    expect(validIndicator("8.8.8.256", "ip")).toBe(false);
    expect(validIndicator("evil.com", "domain")).toBe(true);
    expect(validIndicator("not a domain", "domain")).toBe(false);
    expect(validIndicator("https://evil.com/a", "uri")).toBe(true);
    expect(validIndicator("evil.com", "uri")).toBe(false);
    expect(validIndicator("d41d8cd98f00b204e9800998ecf8427e", "file_hash")).toBe(true);
    expect(validIndicator("zzz", "file_hash")).toBe(false);
    expect(validIndicator("CVE-2026-1234", "cve")).toBe(true);
    expect(validIndicator("CVE-26-1", "cve")).toBe(false);
  });
});

describe("normalizeIndicatorValue", () => {
  it("lowercases domains/hashes and uppercases CVE/MITRE", () => {
    expect(normalizeIndicatorValue("Evil.COM", "domain")).toBe("evil.com");
    expect(normalizeIndicatorValue("cve-2026-1234", "cve")).toBe("CVE-2026-1234");
    expect(normalizeIndicatorValue("1.2.3.4", "ip")).toBe("1.2.3.4");
  });
});

describe("normalizeIndicator", () => {
  it("maps fanged and defanged forms to the same stored value", () => {
    expect(normalizeIndicator("evil[.]com")).toBe("evil.com");
    expect(normalizeIndicator("evil.com")).toBe("evil.com");
    expect(normalizeIndicator("8.8.8[.]8")).toBe("8.8.8.8");
    expect(normalizeIndicator("hxxps://bad[.]tld/x")).toBe("https://bad.tld/x");
    expect(normalizeIndicator("  1.2.3.4  ")).toBe("1.2.3.4");
  });
});
