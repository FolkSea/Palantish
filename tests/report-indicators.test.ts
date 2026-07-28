import { describe, it, expect } from "vitest";
import { extractIndicators } from "@/lib/report-indicators";

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

  it("returns empty sets when nothing is present", () => {
    const i = extractIndicators("A generic advisory with no indicators.");
    expect(i.ips).toHaveLength(0);
    expect(i.domains).toHaveLength(0);
    expect(i.uris).toHaveLength(0);
    expect(i.files).toHaveLength(0);
    expect(i.mitre).toHaveLength(0);
  });
});
