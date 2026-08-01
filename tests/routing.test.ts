import { describe, expect, it } from "vitest";
import { findCve, resolveReportKind } from "@/lib/ingest/routing";
import type { EnrichedItem } from "@/lib/ingest/types";

function item(overrides: Partial<EnrichedItem> = {}): EnrichedItem {
  return {
    title: "Security report",
    description: null,
    url: "https://example.com/report",
    publishedAt: new Date("2026-01-01T00:00:00Z"),
    nexus: null,
    itemType: "report",
    confidence: "suspected",
    crowdstrikeAdversary: null,
    sourceName: "Example",
    rawHash: "hash",
    labels: [],
    ...overrides,
  };
}

describe("report routing", () => {
  it("routes attributed activity to research before using the model section", () => {
    expect(
      resolveReportKind(item({ dashboardKind: "breach" }), true, false),
    ).toBe("research");
  });

  it("uses the model section when deterministic routing has no evidence", () => {
    expect(
      resolveReportKind(item({ dashboardKind: "breach" }), false, false),
    ).toBe("breach");
  });

  it("requires a CVE before accepting an exploit section", () => {
    const report = item({ dashboardKind: "exploit" });
    expect(resolveReportKind(report, false, false)).toBe("other");
    expect(resolveReportKind(report, false, true)).toBe("exploit");
  });

  it("normalises an extracted CVE identifier", () => {
    expect(findCve(item({ description: "Affected: cve-2026-12345" }))).toBe(
      "CVE-2026-12345",
    );
  });
});
