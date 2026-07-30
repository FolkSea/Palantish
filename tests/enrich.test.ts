import { describe, it, expect } from "vitest";
import {
  RulesEnricher,
  GROUP_TABLE,
  sortGroups,
  deriveAdversaryFromText,
  computeAdversaryLabel,
  classifyItemType,
  type GroupEntry,
} from "@/lib/ingest/enrich/rules";
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

  it("keeps single-victim ransomware activity but drops a bare crew mention", async () => {
    // A crew hitting even a single victim is real activity - keep it.
    const incident = await enricher.enrich(
      candidate({ title: "LockBit affiliate hits a small firm" }),
    );
    expect(incident).not.toBeNull();

    // A crew name with no incident/analysis signal is a bare mention - drop it.
    const mention = await enricher.enrich(
      candidate({ title: "LockBit tops this quarter's threat rankings" }),
    );
    expect(mention).toBeNull();

    const large = await enricher.enrich(
      candidate({
        title: "LockBit mass campaign hits hundreds of organizations",
        description: "Widespread ransomware across multiple sectors.",
      }),
    );
    expect(large).not.toBeNull();
    expect(large!.itemType).toBe("breach");
  });

  it("keeps eCrime research/analysis as a report, even when not large-scale", async () => {
    // No large-scale language: the crew drop-gate would drop this, but research
    // about the crew is intelligence worth keeping.
    const out = await enricher.enrich(
      candidate({
        title: "LockBit's new loader dissected: a technical analysis",
        description: "A close look at the loader's obfuscation.",
      }),
    );
    expect(out).not.toBeNull();
    expect(out!.itemType).toBe("report");
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

describe("Rest of the World attribution", () => {
  it("attributes a SideWinder item to rest_of_world with the India CS name", async () => {
    const out = await enricher.enrich(
      candidate({
        title: "SideWinder targets South Asian government networks",
        description: "The India-nexus actor deployed a new backdoor.",
      }),
    );
    expect(out).not.toBeNull();
    expect(out!.nexus).toBe("rest_of_world");
    expect(out!.itemType).toBe("actor_activity");
    expect(out!.crowdstrikeAdversary).toBe("Razor Tiger");
  });

  it("labels an unnamed India post as UNID TIGER", () => {
    const label = computeAdversaryLabel(
      null,
      "rest_of_world",
      "Indian APT campaign against neighbours",
      null,
      sortGroups(GROUP_TABLE),
    );
    expect(label).toBe("UNID TIGER");
  });
});

describe("deriveAdversaryFromText", () => {
  const groups = sortGroups(GROUP_TABLE);

  it("returns a specific named mention (original casing) when there is no CS name", () => {
    expect(
      deriveAdversaryFromText("Salt Typhoon breached US telecoms", null, groups),
    ).toBe("Salt Typhoon");
  });

  it("prefers the CrowdStrike cryptonym when the group has one", () => {
    expect(
      deriveAdversaryFromText("Volt Typhoon pre-positions in OT", null, groups),
    ).toBe("Vanguard Panda");
  });

  it("ignores generic single-word aliases", () => {
    expect(deriveAdversaryFromText("A panda in the zoo", null, groups)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(deriveAdversaryFromText("Ordinary security update", null, groups)).toBeNull();
  });
});

describe("classifyItemType: research vs breach for eCrime / hacktivism crews", () => {
  const crew = (alias: string, cs: string): GroupEntry => ({
    alias,
    nexus: "other",
    cs,
  });

  it("classes a research paper about an eCrime crew as a report", () => {
    const type = classifyItemType(
      candidate({ title: "Toy Ghouls' new toy: the GenieLocker ransomware" }),
      crew("toy ghouls", "Toy Ghouls"),
    );
    expect(type).toBe("report");
  });

  it("classes analysis of a hacktivist collective as a report", () => {
    const type = classifyItemType(
      candidate({
        title: "KillNet unpacked: a technical analysis of the DDoS toolkit",
      }),
      crew("killnet", "KillNet"),
    );
    expect(type).toBe("report");
  });

  it("still classes an eCrime incident/campaign as a breach", () => {
    const type = classifyItemType(
      candidate({
        title: "LockBit mass campaign hits hundreds of organizations",
        description: "Widespread ransomware across multiple sectors.",
      }),
      crew("lockbit", "LockBit"),
    );
    expect(type).toBe("breach");
  });
});
