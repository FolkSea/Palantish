import { describe, it, expect } from "vitest";
import {
  buildRunNotifications,
  buildPocNotification,
} from "@/lib/notifications/run-messages";

function build(over: Record<string, unknown> = {}) {
  return buildRunNotifications({
    runId: "run-1",
    scoped: false,
    added: 0,
    summarised: false,
    flaggedIocs: 0,
    errors: [],
    staleFeeds: 0,
    staleDays: 30,
    ...over,
  } as Parameters<typeof buildRunNotifications>[0]);
}

describe("buildRunNotifications", () => {
  it("announces a full run with the count added", () => {
    const feeds = build({ added: 12 }).find((s) => s.kind === "feeds_ingested");
    expect(feeds?.title).toBe("All feeds ingested");
    expect(feeds?.body).toBe("12 new reports added");
    expect(feeds?.href).toBe("/");
  });

  it("distinguishes a single-feed update from a full run", () => {
    const sent = build({ scoped: true, added: 1 });
    expect(sent.some((s) => s.kind === "feeds_ingested")).toBe(false);
    const feed = sent.find((s) => s.kind === "feed_ingested");
    expect(feed?.title).toBe("Feed updated");
    // Singular, because "1 new reports added" reads as a bug.
    expect(feed?.body).toBe("1 new report added");
  });

  it("still reports a run that added nothing", () => {
    // Silence would be indistinguishable from the ingest not having run.
    expect(build({ added: 0 }).find((s) => s.kind === "feeds_ingested")?.body).toBe(
      "No new reports",
    );
  });

  it("keys every notification on the run, so a chained run repeats nothing", () => {
    const sent = build({
      added: 3,
      summarised: true,
      flaggedIocs: 2,
      errors: ["x"],
      staleFeeds: 1,
    });
    expect(sent.length).toBe(5);
    for (const s of sent) expect(s.dedupeKey.endsWith(":run-1")).toBe(true);
    // One key per kind, or two of them would collapse into a single row.
    expect(new Set(sent.map((s) => s.dedupeKey)).size).toBe(sent.length);
  });

  it("mentions the summary only when it was actually regenerated", () => {
    expect(build({ summarised: false }).some((s) => s.kind === "summary_updated")).toBe(false);
    expect(build({ summarised: true }).some((s) => s.kind === "summary_updated")).toBe(true);
  });

  it("reports suspect indicators as one count, not one each", () => {
    const iocs = build({ flaggedIocs: 40 }).filter((s) => s.kind === "suspect_iocs");
    expect(iocs).toHaveLength(1);
    expect(iocs[0].title).toBe("40 suspect indicators to review");
    expect(iocs[0].href).toBe("/settings?tab=review");
  });

  it("says nothing about indicators when none were flagged", () => {
    expect(build({ flaggedIocs: 0 }).some((s) => s.kind === "suspect_iocs")).toBe(false);
  });

  it("summarises errors with a count and the first one", () => {
    const err = build({ errors: ["feed x: timeout", "feed y: 500"] }).find(
      (s) => s.kind === "ingest_errors",
    );
    expect(err?.title).toBe("Ingest finished with 2 errors");
    expect(err?.body).toBe("feed x: timeout");
  });

  it("stays quiet about errors when there were none", () => {
    expect(build().some((s) => s.kind === "ingest_errors")).toBe(false);
  });

  it("raises stale feeds only when some are stale", () => {
    expect(build().some((s) => s.kind === "stale_feeds")).toBe(false);
    const stale = build({ staleFeeds: 3 }).find((s) => s.kind === "stale_feeds");
    expect(stale?.title).toBe("3 feeds look stale");
    expect(stale?.body).toContain("30 days");
    // The feed list, not the settings root: the reader should land on the
    // panel showing which feed is stale.
    expect(stale?.href).toBe("/settings?tab=sources");
  });

  it("gives every notification somewhere to go", () => {
    const sent = build({ added: 1, summarised: true, flaggedIocs: 1, errors: ["e"], staleFeeds: 1 });
    for (const s of sent) expect(s.href, s.kind).toBeTruthy();
  });
});

describe("buildPocNotification", () => {
  const poc = {
    itemId: "item-1",
    rawHash: "abc123",
    cveId: "CVE-2026-1234",
    headline: "Exploit code published for Fortinet flaw",
  };

  it("names the CVE and links to the report", () => {
    const n = buildPocNotification(poc);
    expect(n.kind).toBe("poc_released");
    expect(n.title).toBe("New PoC released: CVE-2026-1234");
    expect(n.body).toBe("Exploit code published for Fortinet flaw");
    expect(n.href).toBe("/item/abc123");
  });

  it("keys on the report, so a re-run raises it once", () => {
    // Keying on the run would re-announce the same PoC on every ingest that
    // happened to touch the report.
    expect(buildPocNotification(poc).dedupeKey).toBe("poc_released:item-1");
  });

  it("still says something useful without a CVE id", () => {
    const n = buildPocNotification({ ...poc, cveId: null });
    expect(n.title).toBe("New PoC released");
  });

  it("leaves the body empty rather than blank when there is no headline", () => {
    expect(buildPocNotification({ ...poc, headline: null }).body).toBeNull();
    expect(buildPocNotification({ ...poc, headline: "   " }).body).toBeNull();
  });
});
