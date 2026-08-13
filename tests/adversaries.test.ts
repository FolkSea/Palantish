import { describe, it, expect } from "vitest";
import { buildGroupsFromAdversaries } from "@/lib/ingest/adversaries";

// deriveNexus and its siblings went with the adversaries.json loader: an
// actor's nexus is a column on the row now, not something inferred from a
// CrowdStrike export's animal cryptonym at load time.
import { sortGroups, matchGroup } from "@/lib/ingest/enrich/rules";

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
