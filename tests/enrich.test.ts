import { describe, it, expect } from "vitest";
import {
  RulesEnricher,
  deriveAdversaryFromText,
  computeAdversaryLabel,
  classifyItemType,
  isVulnAdvisory,
  type GroupEntry,
} from "@/lib/ingest/enrich/rules";
import { catalogueGroups } from "./helpers/catalogue";
import type { RawCandidate } from "@/lib/ingest/types";

// The enricher and all attribution are driven by the real adversary catalogue -
// the single source of actor identity, no hard-coded table.
const groups = catalogueGroups();
const enricher = new RulesEnricher(groups);

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
    expect(out!.crowdstrikeAdversary).toBe("VANGUARD PANDA");
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
    expect(out!.crowdstrikeAdversary).toBe("FANCY BEAR");
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
    // Named-actor activity is the actor's own activity -> the eCrime cards.
    expect(large!.itemType).toBe("actor_activity");
  });

  it("keeps eCrime research/analysis as actor activity, even when not large-scale", async () => {
    // No large-scale language: the crew drop-gate would drop this, but research
    // about the crew is intelligence worth keeping - and it is named-actor
    // activity, so it belongs in the eCrime cards.
    const out = await enricher.enrich(
      candidate({
        title: "LockBit's new loader dissected: a technical analysis",
        description: "A close look at the loader's obfuscation.",
      }),
    );
    expect(out).not.toBeNull();
    expect(out!.itemType).toBe("actor_activity");
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
    expect(out!.crowdstrikeAdversary).toBe("RAZOR TIGER");
  });

  it("labels an unnamed India post as UNID TIGER", () => {
    const label = computeAdversaryLabel(
      null,
      "rest_of_world",
      "Indian APT campaign against neighbours",
      null,
      groups,
    );
    expect(label).toBe("UNID TIGER");
  });
});

describe("deriveAdversaryFromText", () => {
  it("resolves a community alias to its CrowdStrike cryptonym", () => {
    expect(
      deriveAdversaryFromText("Salt Typhoon breached US telecoms", null, groups),
    ).toBe("OPERATOR PANDA");
  });

  it("prefers the CrowdStrike cryptonym when the group has one", () => {
    expect(
      deriveAdversaryFromText("Volt Typhoon pre-positions in OT", null, groups),
    ).toBe("VANGUARD PANDA");
  });

  it("ignores generic single-word words that are not actors", () => {
    expect(deriveAdversaryFromText("A panda in the zoo", null, groups)).toBeNull();
  });

  it("never returns a country name as an adversary", () => {
    // No catalogue actor is named "North Korea", so a bare country mention has
    // no specific attribution - the label falls back to UNID CHOLLIMA.
    expect(
      deriveAdversaryFromText("North Korean hackers hit a firm", null, groups),
    ).toBeNull();
  });

  it("matches Lazarus to LABYRINTH CHOLLIMA even when the country is named", () => {
    expect(
      deriveAdversaryFromText(
        "North Korea's Lazarus Group shares tools with a crew",
        null,
        groups,
      ),
    ).toBe("LABYRINTH CHOLLIMA");
  });

  it("matches the eCrime crew ShinyHunters by name", () => {
    expect(
      deriveAdversaryFromText(
        "ShinyHunters claims Brinks Home breach",
        null,
        groups,
      ),
    ).toBe("ShinyHunters");
    // Also matches the spaced spelling.
    expect(
      deriveAdversaryFromText("Shiny Hunters leak stolen data", null, groups),
    ).toBe("ShinyHunters");
  });

  it("returns null when nothing matches", () => {
    expect(deriveAdversaryFromText("Ordinary security update", null, groups)).toBeNull();
  });
});

describe("isVulnAdvisory", () => {
  it("recognises vulnerability advisory titles (English + French)", () => {
    for (const t of [
      "2026-007: Critical Vulnerability in Windows Netlogon",
      "Multiple vulnerabilities in Ivanti Sentry",
      "Cisco ACI Multi-Site CloudSec Information Disclosure Vulnerability",
      "Multiples vulnerabilites dans les produits VMware (30 juillet 2026)",
      "Vulnerabilite dans Apache Tomcat (29 juillet 2026)",
    ])
      expect(isVulnAdvisory(t)).toBe(true);
  });

  it("does not match unrelated titles", () => {
    for (const t of [
      "SilverFox Targets Japanese Manufacturer with BYOVD Chain",
      "Weekly security roundup",
      "ShinyHunters claims Brinks Home breach",
    ])
      expect(isVulnAdvisory(t)).toBe(false);
  });
});

describe("classifyItemType: named actors are actor activity", () => {
  const crew = (alias: string, cs: string): GroupEntry => ({
    alias,
    nexus: "other",
    cs,
  });

  it("classes a research paper about an eCrime crew as actor activity", () => {
    const type = classifyItemType(
      candidate({ title: "Toy Ghouls' new toy: the GenieLocker ransomware" }),
      crew("toy ghouls", "Toy Ghouls"),
    );
    expect(type).toBe("actor_activity");
  });

  it("classes an eCrime incident/campaign as actor activity, not a breach", () => {
    // Attributed to a named crew, so it is the crew's activity (the eCrime
    // cards) - not an unattributed breach disclosure.
    const type = classifyItemType(
      candidate({
        title: "LockBit mass campaign hits hundreds of organizations",
        description: "Widespread ransomware across multiple sectors.",
      }),
      crew("lockbit", "LockBit"),
    );
    expect(type).toBe("actor_activity");
  });

  it("classes an unattributed breach disclosure as a breach", () => {
    const type = classifyItemType(
      candidate({
        title: "Acme Corp discloses a data breach affecting customers",
        description: "Stolen data included names and emails.",
      }),
      null,
    );
    expect(type).toBe("breach");
  });
});
