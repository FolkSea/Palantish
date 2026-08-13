import { describe, it, expect } from "vitest";
import { isMatchableAlias, isStrongAlias } from "@/lib/ingest/alias-quality";
import { buildGroupsFromAdversaries } from "@/lib/ingest/adversaries";
import { sortGroups, matchGroup, matchAdversaryGroup } from "@/lib/ingest/enrich/rules";

describe("isMatchableAlias", () => {
  // The bug this exists for: WINNTI GROUP carried the alias "LEAD", so any
  // report containing "lead to" was attributed to it.
  it("rejects a single ordinary word", () => {
    for (const alias of ["LEAD", "lead", "Play", "Royal", "Hive", "Snake", "Maze"])
      expect(isMatchableAlias(alias)).toBe(false);
  });

  it("keeps the designators and coinages that actually identify an actor", () => {
    for (const alias of ["APT41", "Brass Typhoon", "BARIUM", "Turla", "Qilin", "TG-2633"])
      expect(isMatchableAlias(alias)).toBe(true);
  });

  // Only whole single-word aliases are checked, so a phrase built from common
  // words is still a phrase somebody chose.
  it("keeps a phrase whose words are ordinary on their own", () => {
    for (const alias of ["Dark Halo", "Static Kitten", "Cosmic Wolf"])
      expect(isMatchableAlias(alias)).toBe(true);
  });

  it("still rejects anything too short to be distinctive", () => {
    for (const alias of ["", "AB", "TG5"]) expect(isMatchableAlias(alias)).toBe(false);
  });
});

describe("isStrongAlias", () => {
  it("counts a phrase or a designator with a digit", () => {
    for (const alias of ["Twill Typhoon", "APT41", "TG-2633"])
      expect(isStrongAlias(alias)).toBe(true);
  });

  it("does not count a lone coined word", () => {
    for (const alias of ["Turla", "Winnti", "BARIUM"])
      expect(isStrongAlias(alias)).toBe(false);
  });

  it("never counts something that cannot match at all", () => {
    expect(isStrongAlias("Play")).toBe(false);
  });
});

describe("the catalogue matcher", () => {
  const groups = sortGroups(
    buildGroupsFromAdversaries([
      {
        name: "WINNTI GROUP",
        nexus: "china",
        community_identifiers: ["LEAD", "Leopard Typhoon"],
      },
      { name: "WICKED PANDA", nexus: "china", community_identifiers: ["APT41", "Winnti"] },
    ]),
  );

  it("does not build a matcher out of an ordinary word", () => {
    expect(groups.some((g) => g.alias.toLowerCase() === "lead")).toBe(false);
    // Aliases are stored lowercased, since the haystack is too.
    expect(groups.some((g) => g.alias === "apt41")).toBe(true);
  });

  it("leaves an unrelated report alone", () => {
    const text =
      "737 chrome vpn extensions caught routing traffic through proxies. " +
      "the findings lead to a wider review, and play store listings were pulled.";
    expect(matchGroup(text, groups)).toBeNull();
  });

  it("still attributes a report that names the actor", () => {
    expect(matchGroup("apt41 tooling overlaps", groups)?.cs).toBe("WICKED PANDA");
  });
});

describe("attributing from the article body", () => {
  const groups = sortGroups(
    buildGroupsFromAdversaries([
      { name: "MUSTANG PANDA", nexus: "china", community_identifiers: ["Twill Typhoon"] },
      { name: "WICKED PANDA", nexus: "china", community_identifiers: ["Winnti"] },
    ]),
  );
  const TITLE = "Trojanised installer delivers a backdoor";

  // The body is the whole fetched page. A lone coined word in it may be a link
  // to last week's story rather than this report's subject.
  it("ignores a lone word that only appears in the body", () => {
    const body = "Related coverage: our earlier report on Winnti operations.";
    expect(matchAdversaryGroup(TITLE, null, groups, body)).toBeNull();
  });

  it("still attributes when the body names an actor in full", () => {
    const body = "Analysts attribute the campaign to Twill Typhoon.";
    expect(matchAdversaryGroup(TITLE, null, groups, body)?.cs).toBe("MUSTANG PANDA");
  });

  // The restriction is on the body only: a title naming the actor is the report
  // saying what it is about.
  it("accepts a lone word when the report itself states it", () => {
    expect(matchAdversaryGroup("Winnti tooling resurfaces", null, groups)?.cs).toBe(
      "WICKED PANDA",
    );
  });

  it("prefers what the report states over what the body mentions", () => {
    const stated = matchAdversaryGroup(
      "Twill Typhoon campaign",
      null,
      groups,
      "Related: Winnti operations.",
    );
    expect(stated?.cs).toBe("MUSTANG PANDA");
  });
});
