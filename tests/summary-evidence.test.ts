import { describe, expect, it } from "vitest";
import {
  formatSummaryEvidence,
  type LinkableItem,
} from "@/lib/summary/aggregates";

const evidence: LinkableItem[] = [
  {
    id: 1,
    kind: "report",
    period: "last24h",
    title: "Campaign update",
    url: "https://example.com/private-path",
    description: "A generic description",
    reportSummary:
      "An actor targeted utilities with a new loader.\nThe campaign expanded overnight.",
    actor: "Example Actor",
    itemType: "campaign",
    sourceName: "Example Source",
    date: "2026-08-01",
    rawHash: "secret-hash",
  },
  {
    id: 2,
    kind: "vuln",
    period: "days8to30",
    title: "CVE trend",
    url: null,
    description: "Exploitation persisted throughout the baseline window.",
    reportSummary: null,
    actor: null,
    itemType: "vulnerability",
    sourceName: null,
    date: "2026-07-10",
    rawHash: null,
  },
];

describe("executive summary evidence", () => {
  it("gives the model narrative evidence separated into time windows", () => {
    const formatted = formatSummaryEvidence(evidence);

    expect(formatted).toContain("[1] window=last24h");
    expect(formatted).toContain("window=days8to30");
    expect(formatted).toContain(
      "synopsis=An actor targeted utilities with a new loader. The campaign expanded overnight.",
    );
    expect(formatted).toContain(
      "synopsis=Exploitation persisted throughout the baseline window.",
    );
  });

  it("keeps URLs and internal hashes out of the model context", () => {
    const formatted = formatSummaryEvidence(evidence);

    expect(formatted).not.toContain("https://");
    expect(formatted).not.toContain("secret-hash");
  });
});
