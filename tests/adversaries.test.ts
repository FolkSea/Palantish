import { describe, it, expect } from "vitest";
import { deriveNexus, buildGroupsFromAdversaries } from "@/lib/ingest/adversaries";
import { sortGroups, matchGroup } from "@/lib/ingest/enrich/rules";

describe("deriveNexus", () => {
  it("maps animal classifiers to nation-state nexus", () => {
    expect(deriveNexus({ animal_classifier: "PANDA" })).toBe("china");
    expect(deriveNexus({ animal_classifier: "BEAR" })).toBe("russia");
    expect(deriveNexus({ animal_classifier: "CHOLLIMA" })).toBe("north_korea");
    expect(deriveNexus({ animal_classifier: "KITTEN" })).toBe("iran");
  });

  it("treats SPIDER/JACKAL as other (eCrime / hacktivist)", () => {
    expect(deriveNexus({ animal_classifier: "SPIDER" })).toBe("other");
    expect(deriveNexus({ animal_classifier: "JACKAL" })).toBe("other");
  });

  it("treats other state-animal cryptonyms as rest_of_world", () => {
    expect(deriveNexus({ animal_classifier: "TIGER" })).toBe("rest_of_world");
    expect(deriveNexus({ animal_classifier: "BUFFALO" })).toBe("rest_of_world");
  });

  it("falls back to the description for unclassified adversaries", () => {
    expect(
      deriveNexus({
        animal_classifier: null,
        description: "An Iran-nexus adversary targeting telecoms.",
      }),
    ).toBe("iran");
  });

  it("uses StateSponsored motivation for unclassified state actors", () => {
    expect(
      deriveNexus({
        animal_classifier: null,
        description: "Targets government entities.",
        motivation: ["StateSponsored"],
      }),
    ).toBe("rest_of_world");
    expect(
      deriveNexus({ animal_classifier: null, motivation: ["Criminal"] }),
    ).toBe("other");
  });
});

describe("buildGroupsFromAdversaries + matchGroup", () => {
  const groups = sortGroups(
    buildGroupsFromAdversaries([
      {
        name: "FANCY BEAR",
        nexus: "russia",
        community_identifiers: ["APT28", "Sofacy"],
      },
      {
        name: "WICKED PANDA",
        nexus: "china",
        community_identifiers: ["APT41"],
      },
    ]),
  );

  it("maps a community alias to its CrowdStrike name and nexus", () => {
    const m = matchGroup("report on apt28 spearphishing", groups);
    expect(m?.cs).toBe("FANCY BEAR");
    expect(m?.nexus).toBe("russia");
  });

  it("matches the cryptonym itself", () => {
    expect(matchGroup("wicked panda activity", groups)?.nexus).toBe("china");
  });

  it("respects word boundaries (no substring false positives)", () => {
    // "apt41" must not match inside "apt410"
    expect(matchGroup("advisory apt410 released", groups)).toBeNull();
  });

  it("drops aliases shorter than the minimum length", () => {
    const g = buildGroupsFromAdversaries([
      { name: "X", nexus: "russia", community_identifiers: ["ab"] },
    ]);
    expect(g).toHaveLength(0);
  });
});
