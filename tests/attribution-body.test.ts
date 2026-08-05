import { describe, it, expect } from "vitest";
import {
  computeAdversaryLabel,
  deriveAdversaryFromText,
  matchAdversaryGroup,
  sortGroups,
} from "@/lib/ingest/enrich/rules";
import { buildGroupsFromAdversaries } from "@/lib/ingest/adversaries";

// The catalogue entry exactly as adversaries.json holds it.
const groups = sortGroups(
  buildGroupsFromAdversaries([
    {
      name: "MUSTANG PANDA",
      nexus: "china",
      motivation: ["nation_state"],
      community_identifiers: ["Twill Typhoon", "TANTALUM", "BRONZE PRESIDENT"],
      internal_alternative_names: [],
    },
  ]),
);

// The report that prompted this: the actor is named only in the article.
const TITLE =
  "QuickFox Supply Chain Attack Delivers FDMTP Backdoor via Trojanized Windows Installer";
const BODY =
  "Researchers link the campaign to TWILL TYPHOON, a China-nexus group also " +
  "tracked as Mustang Panda, which trojanized the QuickFox VPN installer.";

describe("attribution reads the fetched article, not just the headline", () => {
  it("misses the actor when only the title and feed description are searched", () => {
    // The behaviour before this change, kept as a test so the regression is
    // visible rather than theoretical.
    expect(deriveAdversaryFromText(TITLE, null, groups)).toBeNull();
  });

  it("finds the actor named in the body under a vendor alias", () => {
    expect(deriveAdversaryFromText(TITLE, null, groups, BODY)).toBe("MUSTANG PANDA");
    expect(matchAdversaryGroup(TITLE, null, groups, BODY)?.nexus).toBe("china");
  });

  it("attributes the report even when the model offered no nexus", () => {
    // A catalogue hit carries its own nexus, so recognising the actor is enough.
    expect(computeAdversaryLabel(null, null, TITLE, null, groups, BODY)).toBe(
      "MUSTANG PANDA",
    );
  });

  it("leaves a report unattributed when nothing names an actor", () => {
    expect(
      computeAdversaryLabel(null, null, TITLE, null, groups, "No group is named here."),
    ).toBeNull();
  });

  it("does not let the body override an actor the model identified", () => {
    expect(
      computeAdversaryLabel("FANCY BEAR", "russia", TITLE, null, groups, BODY),
    ).toBe("FANCY BEAR");
  });

  it("still works with no body at all", () => {
    expect(
      computeAdversaryLabel(null, null, "Mustang Panda targets Europe", null, groups),
    ).toBe("MUSTANG PANDA");
  });
});
