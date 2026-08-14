import { describe, it, expect } from "vitest";
import { parseReanalysis } from "@/lib/agent/reanalyse";
import { reconcileIndicators } from "@/lib/agent/ioc-validate";

const FULL = JSON.stringify({
  relevant: true,
  fetchStatus: "full",
  summary: "Jewelbug ran espionage and crypto fraud from the same tooling.",
  nexus: "china",
  crowdstrikeAdversary: "WICKED PANDA",
  confidence: "suspected",
  itemType: "actor_activity",
  dashboardKind: "research",
  labels: { malware: ["FlyingEagle"], adversary: ["Jewelbug"], target: [], vector: [], ai: [] },
  indicators: {
    ipv4: ["45.61.136.5"],
    ipv6: [],
    domains: ["evil-update.example"],
    fileHashes: [],
    cves: ["CVE-2026-1234"],
  },
  mitreTechniques: ["T1059"],
  visibilityGaps: "The report gives no timestamps, so nobody can scope the window.",
  evidence: [],
});

describe("parseReanalysis", () => {
  it("reads the triage fields and the gap note together", () => {
    const r = parseReanalysis(FULL)!;
    expect(r.crowdstrikeAdversary).toBe("WICKED PANDA");
    expect(r.labels).toContain("Adversary/Jewelbug");
    expect(r.indicators.domains).toEqual(["evil-update.example"]);
    expect(r.visibilityGaps).toMatch(/no timestamps/);
  });

  it("survives a response with no gap note", () => {
    const text = FULL.replace(/,"visibilityGaps":"[^"]*"/, "");
    expect(parseReanalysis(text)?.visibilityGaps).toBe("");
  });

  // The whole write is skipped when this is null, so it has to be null on
  // anything that is not a re-analysis rather than a half-populated object.
  it("returns null when there is no JSON to read", () => {
    expect(parseReanalysis("I could not fetch that page.")).toBeNull();
  });
});

describe("reconciling a re-analysis", () => {
  // The article body a sweep would otherwise mine: one indicator the model
  // judged real, and a pile of page furniture it deliberately left out.
  const page = [
    "Traffic went to evil-update.example (45.61.136.5).",
    "Follow us on twitter.example, read more at vendor-blog.example,",
    "assets load from cdn-static.example.",
  ].join(" ");
  const llm = {
    ipv4: ["45.61.136.5"],
    ipv6: [],
    domains: ["evil-update.example"],
    fileHashes: [],
    cves: [],
  };

  it("keeps only what the model judged, when asked not to sweep the text", () => {
    const rows = reconcileIndicators(llm, [], page, {}, { extractFromText: false });
    expect(rows.map((r) => r.value).sort()).toEqual([
      "45.61.136.5",
      "evil-update.example",
    ]);
  });

  // Ingest still wants the sweep: there the result is added to the report, so a
  // missed indicator costs more than an extra row.
  it("still unions in the deterministic extraction by default", () => {
    const rows = reconcileIndicators(llm, [], page);
    expect(rows.map((r) => r.value)).toContain("cdn-static.example");
  });

  it("rejects an indicator that is not in the article", () => {
    const rows = reconcileIndicators(
      { ...llm, domains: ["evil-update.example", "invented.example"] },
      [],
      page,
      {},
      { extractFromText: false },
    );
    expect(rows.map((r) => r.value)).not.toContain("invented.example");
  });
});
