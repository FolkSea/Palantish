import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCertEuBlog, parseCertEuDate } from "@/lib/ingest/readers/cert-eu-blog";
import { readerFor } from "@/lib/ingest/readers";

const HTML = readFileSync(
  join(process.cwd(), "tests/fixtures/cert-eu-blog.html"),
  "utf8",
);
const SOURCE = { name: "CERT-EU Blog", category: "government" as const };
const BASE = "https://cert.europa.eu/blog";

describe("parseCertEuDate", () => {
  it("reads the printed date, in CEST", () => {
    // Summer time: 17:50 CEST is 15:50 UTC.
    expect(parseCertEuDate("Tuesday, April 21, 2026 05:50:00 PM CEST")?.toISOString())
      .toBe("2026-04-21T15:50:00.000Z");
  });

  it("reads the printed date, in CET", () => {
    // Winter time is one hour, not two: 16:45 CET is 15:45 UTC.
    expect(parseCertEuDate("Friday, February 13, 2026 04:45:00 PM CET")?.toISOString())
      .toBe("2026-02-13T15:45:00.000Z");
  });

  it("handles noon and midnight, where 12-hour clocks go wrong", () => {
    expect(parseCertEuDate("Monday, June 01, 2026 12:00:00 AM CEST")?.toISOString())
      .toBe("2026-05-31T22:00:00.000Z");
    expect(parseCertEuDate("Monday, June 01, 2026 12:00:00 PM CEST")?.toISOString())
      .toBe("2026-06-01T10:00:00.000Z");
  });

  it("copes with a missing weekday, seconds or zone", () => {
    expect(parseCertEuDate("April 21, 2026 05:50 PM CEST")?.toISOString())
      .toBe("2026-04-21T15:50:00.000Z");
    // No zone: read as UTC rather than as the server's own timezone.
    expect(parseCertEuDate("April 21, 2026 15:50:00")?.toISOString())
      .toBe("2026-04-21T15:50:00.000Z");
  });

  it("returns null rather than an invalid date", () => {
    for (const bad of ["", "not a date", "Fooruary 21, 2026 05:50:00 PM CEST"]) {
      expect(parseCertEuDate(bad), bad).toBeNull();
    }
  });
});

describe("parseCertEuBlog", () => {
  const items = parseCertEuBlog(HTML, BASE, SOURCE);

  it("finds every post on the listing", () => {
    expect(items.length).toBe(4);
  });

  it("reads title, absolute link and summary", () => {
    const first = items[0];
    expect(first.title).toBe(
      "AI is changing the economics of vulnerability discovery. Defenders should adapt now",
    );
    expect(first.url).toBe(
      "https://cert.europa.eu/blog/ai-vulnerability-discovery-defenders-must-adapt",
    );
    expect(first.description).toContain("AI-powered tools are discovering vulnerabilities");
    expect(first.sourceName).toBe("CERT-EU Blog");
    expect(first.sourceCategory).toBe("government");
  });

  it("resolves relative hrefs against the listing", () => {
    for (const i of items) {
      expect(i.url.startsWith("https://cert.europa.eu/blog/"), i.url).toBe(true);
    }
  });

  it("ignores the datetime attribute, which is a placeholder on every post", () => {
    // The page hardcodes datetime="2001-05-15T19:00" everywhere; trusting it
    // would date the whole blog to 2001 and bury it in the dashboard.
    expect(HTML).toContain('datetime="2001-05-15T19:00"');
    for (const i of items) {
      expect(i.publishedAt?.getUTCFullYear(), i.title).toBeGreaterThan(2020);
    }
  });

  it("dates the newest post from its printed time", () => {
    expect(items[0].publishedAt?.toISOString()).toBe("2026-04-21T15:50:00.000Z");
  });

  it("keeps a post whose date cannot be read, rather than dropping reporting", () => {
    const broken = HTML.replace(
      /Tuesday, April 21, 2026 05:50:00 PM CEST/,
      "sometime last spring",
    );
    const parsed = parseCertEuBlog(broken, BASE, SOURCE);
    expect(parsed.length).toBe(4);
    expect(parsed[0].publishedAt).toBeNull();
    expect(parsed[0].title).toContain("AI is changing the economics");
  });

  it("returns nothing for a page with no posts", () => {
    expect(parseCertEuBlog("<main><p>Nothing here</p></main>", BASE, SOURCE)).toEqual([]);
  });
});

describe("readerFor", () => {
  it("claims the CERT-EU blog", () => {
    expect(readerFor("https://cert.europa.eu/blog")?.id).toBe("cert-eu-blog");
    expect(readerFor("https://cert.europa.eu/blog/")?.id).toBe("cert-eu-blog");
  });

  it("leaves the working CERT-EU advisory feed alone", () => {
    // That one is real RSS and must keep going through the feed parser.
    expect(readerFor("https://cert.europa.eu/publications/security-advisories-rss"))
      .toBeNull();
  });

  it("claims nothing else", () => {
    expect(readerFor("https://example.com/blog")).toBeNull();
    expect(readerFor("not a url")).toBeNull();
  });
});
