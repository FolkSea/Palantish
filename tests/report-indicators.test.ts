import { describe, it, expect } from "vitest";
import {
  isFilenameOrCode,
  extractIndicators,
  normalizeIndicator,
  validIndicator,
  normalizeIndicatorValue,
  isNonRoutableIp,
  shouldExcludeIp,
  ipAddressOf,
  isIpv4Indicator,
  validIpv4Cidr,
  validIpv6Cidr,
} from "@/lib/report-indicators";

describe("extractIndicators", () => {
  it("extracts IPs, domains, URIs, hashes and MITRE ids", () => {
    const text =
      "The actor used T1059.003 and T1566 to drop payload.exe (sha1 " +
      "da39a3ee5e6b4b0d3255bfef95601890afd80709). C2 at http://evil.example.com/beacon " +
      "and 203.0.113.42, plus the domain updates.malwarehost.net.";
    const i = extractIndicators(text);
    expect(i.ips).toContain("203.0.113.42");
    // The URL itself is not an indicator; its host is.
    expect(i.domains).toContain("evil.example.com");
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
    expect(i.domains).toContain("bad.tld");
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

  it("does not treat web-asset filenames as domains", () => {
    const i = extractIndicators("shows photo.jpeg, hero-image.png and index.html");
    expect(i.domains).toHaveLength(0);
  });

  it("does not treat code identifiers in snippets as domains", () => {
    const i = extractIndicators(
      "The loader calls window.fetch and console.log, then exec.command " +
        "and os.path before beaconing to updates.malwarehost.net",
    );
    expect(i.domains).toContain("updates.malwarehost.net"); // the real IOC
    for (const noise of ["window.fetch", "console.log", "exec.command", "os.path"])
      expect(i.domains).not.toContain(noise);
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

  it("keeps a URL's host as a domain, unless the host is benign", () => {
    const i = extractIndicators(
      "share https://twitter.com/intent/tweet and payload https://evil.example.com/a",
      ["blog.example.org"],
    );
    expect(i.domains).toContain("evil.example.com");
    expect(i.domains.some((d) => d.includes("twitter.com"))).toBe(false);
  });

  it("applies an operator allowlist entry to a host met inside a URL", () => {
    // The ioc_allowlist reaches the extractor as excludeDomains. A press or CDN
    // domain has to be suppressed whether the scraper met it bare or as the
    // host of a link.
    const i = extractIndicators(
      "image https://blogger.googleusercontent.com/img/a/AVvXsEg and " +
        "writeup https://www.thehackernews.com/2026/01/post.html and " +
        "c2 https://real-c2.example.net/panel plus bare thehackernews.com",
      ["thehackernews.com", "blogger.googleusercontent.com"],
    );
    expect(i.domains).toContain("real-c2.example.net");
    expect(i.domains.some((d) => d.includes("thehackernews"))).toBe(false);
    expect(i.domains.some((d) => d.includes("googleusercontent"))).toBe(false);
  });

  it("does not let an allowlisted domain hide a lookalike host", () => {
    // not-thehackernews.com.evil.ru merely contains the allowlisted string; it
    // is a different registrable domain and a plausible IOC in its own right.
    const i = extractIndicators(
      "https://not-thehackernews.com.evil.ru/x",
      ["thehackernews.com"],
    );
    expect(i.domains).toEqual(["not-thehackernews.com.evil.ru"]);
  });

  it("returns empty sets when nothing is present", () => {
    const i = extractIndicators("A generic advisory with no indicators.");
    expect(i.ips).toHaveLength(0);
    expect(i.domains).toHaveLength(0);
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

describe("isNonRoutableIp", () => {
  it("flags loopback, private, link-local, CGNAT and reserved ranges", () => {
    for (const ip of [
      "127.0.0.1", "0.0.0.0", "10.0.0.1", "172.16.5.4", "172.31.9.9",
      "192.168.1.1", "169.254.1.2", "100.64.0.1", "224.0.0.1",
      "255.255.255.255", "255.255.255.0",
    ])
      expect(isNonRoutableIp(ip), ip).toBe(true);
  });
  it("keeps routable (and documentation) addresses", () => {
    for (const ip of ["8.8.8.8", "203.0.113.42", "45.86.230.12", "172.15.0.1", "172.32.0.1"])
      expect(isNonRoutableIp(ip), ip).toBe(false);
  });
});

describe("shouldExcludeIp", () => {
  it("drops non-routable IPs and allowlisted public IPs", () => {
    expect(shouldExcludeIp("127.0.0.1")).toBe(true);
    expect(shouldExcludeIp("1.1.1.1")).toBe(false);
    expect(shouldExcludeIp("1.1.1.1", ["8.8.8.8", "1.1.1.1"])).toBe(true);
    expect(shouldExcludeIp("45.86.230.12", ["8.8.8.8"])).toBe(false);
  });
});

describe("extractIndicators allowlisting", () => {
  it("drops loopback/private IPs but keeps routable ones", () => {
    const i = extractIndicators(
      "beacons to 45.86.230.12 and 127.0.0.1, gateway 192.168.1.1",
    );
    expect(i.ips).toContain("45.86.230.12");
    expect(i.ips).not.toContain("127.0.0.1");
    expect(i.ips).not.toContain("192.168.1.1");
  });

  it("drops allowlisted vendor domains (incl. subdomains) and IPs", () => {
    const i = extractIndicators(
      "See blog.crowdstrike.com and evil.example.com; resolver 1.1.1.1 vs 45.86.230.12",
      ["crowdstrike.com"],
      ["1.1.1.1"],
    );
    expect(i.domains).toContain("evil.example.com");
    expect(i.domains).not.toContain("blog.crowdstrike.com");
    expect(i.ips).toContain("45.86.230.12");
    expect(i.ips).not.toContain("1.1.1.1");
  });
});

describe("isFilenameOrCode", () => {
  it("rejects the server-side page extensions that share links carry", () => {
    // The one that prompted this: facebook.com/sharer/sharer.php on every
    // article footer was being stored as the domain "sharer.php".
    for (const v of [
      "sharer.php", "index.aspx", "login.asp", "view.jsp", "run.cgi",
      "page.phtml", "doc.xhtml",
    ]) {
      expect(isFilenameOrCode(v), v).toBe(true);
    }
  });

  it("rejects asset, data and config filenames", () => {
    for (const v of [
      "index.html", "photo.png", "styles.css", "config.json", "access.log",
      "notes.txt", "data.xml", "dump.sql", "settings.ini", "capture.pcap",
    ]) {
      expect(isFilenameOrCode(v), v).toBe(true);
    }
  });

  it("rejects code identifiers", () => {
    for (const v of ["console.log", "window.fetch", "os.path", "exec.command"]) {
      expect(isFilenameOrCode(v), v).toBe(true);
    }
  });

  it("keeps real domains, including ones whose TLD looks like an extension", () => {
    // These are live TLDs and must survive: deleting a .in or .md domain to
    // catch a filename would be losing a real indicator to catch noise.
    for (const v of [
      "evil.com", "malware.ru", "c2.example.net", "bad.in", "actor.md",
      "site.pl", "shop.do", "news.is", "cdn.io", "portal.app", "x.online",
    ]) {
      expect(isFilenameOrCode(v), v).toBe(false);
    }
  });

  it("is not fooled by an extension appearing mid-domain", () => {
    // Only the LAST label decides; php.example.com is a perfectly good host.
    expect(isFilenameOrCode("php.example.com")).toBe(false);
    expect(isFilenameOrCode("html.evil.ru")).toBe(false);
  });

  it("copes with empty and malformed input", () => {
    expect(isFilenameOrCode("")).toBe(false);
    expect(isFilenameOrCode("   ")).toBe(false);
    expect(isFilenameOrCode("php")).toBe(false); // no dot: not domain-shaped
  });
});

describe("code-identifier rejection must not eat live TLDs", () => {
  it("keeps domains whose TLD is also a programming word", () => {
    // Each of these was previously discarded as a "code identifier": .info,
    // .name, .id, .host, .run, .post and .date are all real TLDs, and the first
    // three of these are genuine indicators seen in the corpus.
    for (const v of [
      "0x666.info", "fixmy-nflix.info", "zimbra-beta.info", "web27.info",
      "actor.name", "tracker.id", "panel.host", "payload.run", "drop.date",
    ]) {
      expect(isFilenameOrCode(v), v).toBe(false);
    }
  });

  it("still rejects the namespaced forms via the head list", () => {
    for (const v of ["console.info", "os.name", "document.id", "process.argv"]) {
      expect(isFilenameOrCode(v), v).toBe(true);
    }
  });
});

describe("vendor social footers", () => {
  it("drops the follow-us links that connect a publisher to itself", () => {
    const i = extractIndicators(
      "Follow us: https://bsky.app/profile/greynoise.bsky.social , " +
        "https://discord.gg/VK9ayHSfAd , https://infosec.exchange/@greynoise , " +
        "https://join.slack.com/t/greynoiseintel/shared_invite/zt-1 , " +
        "https://open.spotify.com/show/1woJ . C2 at https://real-c2.example.net/p",
    );
    expect(i.domains).toContain("real-c2.example.net");
    expect(i.domains.some((d) => d.includes("bsky"))).toBe(false);
  });

  it("keeps the platforms actually used to deliver and exfiltrate", () => {
    // Excluding these parents to tidy a footer would discard real indicators:
    // Discord and Slack webhooks carry stolen data, Telegram and GitHub host
    // payloads. The URL is not stored, but the host still is.
    const i = extractIndicators(
      "exfil to https://discord.com/api/webhooks/123/abc and " +
        "https://hooks.slack.com/services/T00/B00 , payload from " +
        "https://github.com/actor/repo and https://t.me/channel",
    );
    for (const host of ["discord.com", "hooks.slack.com", "github.com", "t.me"])
      expect(i.domains).toContain(host);
  });
});

describe("IP ranges", () => {
  it("extracts a CIDR range as the range, not the base address", () => {
    const i = extractIndicators(
      "Infrastructure sits in 104.192.108.0/22 and 45.86.230.12.",
    );
    expect(i.ips).toContain("104.192.108.0/22");
    expect(i.ips).not.toContain("104.192.108.0");
    expect(i.ips).toContain("45.86.230.12");
  });

  it("takes the prefix from either end of the usual range", () => {
    for (const cidr of ["45.0.0.0/0", "203.0.113.0/24", "45.86.230.12/32"]) {
      expect(extractIndicators(`seen at ${cidr} today`).ips).toContain(cidr);
    }
  });

  // The 24 in a URL is a path. Reading it as a prefix would invent a range the
  // report never named - the address is still the indicator it always was.
  it("does not read a URL path as a prefix", () => {
    const i = extractIndicators("beacon to http://45.86.230.12/24 hourly");
    expect(i.ips).toContain("45.86.230.12");
    expect(i.ips).not.toContain("45.86.230.12/24");
  });

  it("drops a private range, the same as a private address", () => {
    const i = extractIndicators("lateral movement across 10.0.0.0/8 and 10.1.2.3");
    expect(i.ips).toHaveLength(0);
  });

  it("keeps a nonsense prefix as the plain address", () => {
    // /33 is not a v4 prefix; the address is real either way.
    const i = extractIndicators("saw 45.86.230.12/33 in the logs");
    expect(i.ips).toEqual(["45.86.230.12"]);
  });
});

describe("IP range validation", () => {
  it("accepts ranges an analyst types by hand", () => {
    for (const v of ["104.192.108.0/22", "10.0.0.0/8", "2001:db8::/32"])
      expect(validIndicator(v, "ip")).toBe(true);
  });

  it("rejects an impossible prefix or a malformed one", () => {
    for (const v of ["45.86.230.12/33", "45.86.230.12/", "45.86.230.12/08"])
      expect(validIpv4Cidr(v)).toBe(false);
    expect(validIpv6Cidr("2001:db8::/129")).toBe(false);
  });

  it("reads the address out of a range", () => {
    expect(ipAddressOf("104.192.108.0/22")).toBe("104.192.108.0");
    expect(ipAddressOf("45.86.230.12")).toBe("45.86.230.12");
  });

  it("treats a range as an IPv4 indicator, so the IP rules apply to it", () => {
    expect(isIpv4Indicator("104.192.108.0/22")).toBe(true);
    expect(isIpv4Indicator("2001:db8::/32")).toBe(false);
    expect(isNonRoutableIp("192.168.0.0/16")).toBe(true);
    expect(shouldExcludeIp("127.0.0.0/8")).toBe(true);
  });
});
