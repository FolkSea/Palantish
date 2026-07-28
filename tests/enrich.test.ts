import { describe, it, expect } from "vitest";
import { RulesEnricher } from "@/lib/ingest/enrich/rules";
import type { RawCandidate } from "@/lib/ingest/types";

const enricher = new RulesEnricher();

function candidate(partial: Partial<RawCandidate>): RawCandidate {
  return {
    title: "",
    url: "https://example.com/post",
    description: null,
    publishedAt: new Date("2026-07-20"),
    sourceName: "Test Source",
    sourceCategory: "research",
    ...partial,
  };
}

describe("RulesEnricher classification", () => {
  it("classifies a nation-state actor with nexus and CrowdStrike name", async () => {
    const out = await enricher.enrich(
      candidate({
        title: "Volt Typhoon targets critical infrastructure",
        description: "China-nexus actor pre-positions in OT networks.",
      }),
    );
    expect(out).not.toBeNull();
    expect(out!.nexus).toBe("china");
    expect(out!.itemType).toBe("actor_activity");
    expect(out!.crowdstrikeAdversary).toBe("Vanguard Panda");
  });

  it("routes a CVE advisory to the vuln type", async () => {
    const out = await enricher.enrich(
      candidate({
        title: "CVE-2026-12345 actively exploited in the wild",
        description: "Government advisory confirms exploitation.",
        sourceCategory: "government",
      }),
    );
    expect(out).not.toBeNull();
    expect(out!.itemType).toBe("vuln");
    expect(out!.confidence).toBe("confirmed");
  });

  it("prefers a longer alias over a shorter one", async () => {
    const out = await enricher.enrich(
      candidate({ title: "Fancy Bear spearphishing campaign" }),
    );
    expect(out!.nexus).toBe("russia");
    expect(out!.crowdstrikeAdversary).toBe("Fancy Bear");
  });

  it("drops marketing / product-announcement content", async () => {
    const out = await enricher.enrich(
      candidate({
        title: "Introducing our new managed detection webinar",
        description: "Register now for the product announcement.",
      }),
    );
    expect(out).toBeNull();
  });

  it("drops small-scale eCrime but keeps large-scale campaigns", async () => {
    const small = await enricher.enrich(
      candidate({ title: "LockBit affiliate hits a small firm" }),
    );
    expect(small).toBeNull();

    const large = await enricher.enrich(
      candidate({
        title: "LockBit mass campaign hits hundreds of organizations",
        description: "Widespread ransomware across multiple sectors.",
      }),
    );
    expect(large).not.toBeNull();
    expect(large!.itemType).toBe("breach");
  });

  it("drops generic news with no nation-state or vuln signal", async () => {
    const out = await enricher.enrich(
      candidate({
        title: "Weekly security roundup",
        description: "A summary of the week in security.",
        sourceCategory: "news",
      }),
    );
    expect(out).toBeNull();
  });

  it("keeps hacktivist activity by named collective", async () => {
    const out = await enricher.enrich(
      candidate({
        title: "KillNet launches DDoS attacks against European banks",
        description: "The pro-Russia hacktivist collective claimed the campaign.",
        sourceCategory: "news",
      }),
    );
    expect(out).not.toBeNull();
  });

  it("keeps generic hacktivism reporting via keyword", async () => {
    const out = await enricher.enrich(
      candidate({
        title: "Hacktivists deface government portals in coordinated push",
        sourceCategory: "news",
      }),
    );
    expect(out).not.toBeNull();
  });
});
