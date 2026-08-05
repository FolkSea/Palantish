import { describe, it, expect } from "vitest";
import {
  ANIMAL_COUNTRY,
  adversaryLabel,
  animalForCountry,
  isSpecificAdversary,
} from "@/lib/badges";

describe("isSpecificAdversary", () => {
  it("accepts real group names", () => {
    expect(isSpecificAdversary("Wicked Panda")).toBe(true);
    expect(isSpecificAdversary("Salt Typhoon")).toBe(true);
    expect(isSpecificAdversary("ShinyHunters")).toBe(true);
  });

  it("rejects bare animals and placeholders", () => {
    for (const n of ["Bear", "KITTEN", "spider", "Bat", "UNKNOWN", "", null])
      expect(isSpecificAdversary(n)).toBe(false);
  });

  // These four were missing from the guard while the rest of the app happily
  // produced them, so a bare "Leopard" drew a lane and a graph node of its own.
  it("rejects every family the app can produce, not just the big ones", () => {
    for (const n of Object.keys(ANIMAL_COUNTRY)) {
      expect(isSpecificAdversary(n)).toBe(false);
      expect(isSpecificAdversary(n.toLowerCase())).toBe(false);
    }
  });
});

describe("animalForCountry", () => {
  it("reads the stored country rather than guessing", () => {
    expect(animalForCountry("India")).toBe("TIGER");
    expect(animalForCountry(" south korea ")).toBe("CRANE");
    expect(animalForCountry("Belarus")).toBeNull();
    expect(animalForCountry(null)).toBeNull();
  });
});

describe("adversaryLabel", () => {
  it("keeps a specific name", () => {
    expect(adversaryLabel("Voodoo Bear", "russia")).toBe("Voodoo Bear");
  });

  it("maps unattributed country items to UNID <animal>", () => {
    expect(adversaryLabel(null, "russia")).toBe("UNID BEAR");
    expect(adversaryLabel(null, "china")).toBe("UNID PANDA");
    expect(adversaryLabel(null, "iran")).toBe("UNID KITTEN");
    expect(adversaryLabel(null, "north_korea")).toBe("UNID CHOLLIMA");
    expect(adversaryLabel(null, "rest_of_world")).toBe("UNID BAT");
    expect(adversaryLabel(null, "other")).toBe("UNID SPIDER");
  });

  it("promotes bare-animal and UNKNOWN values to UNID <animal>", () => {
    expect(adversaryLabel("Bear", "russia")).toBe("UNID BEAR");
    expect(adversaryLabel("Kitten", "iran")).toBe("UNID KITTEN");
    expect(adversaryLabel("UNKNOWN", "china")).toBe("UNID PANDA");
  });

  it("uses the country's animal within Rest of the World", () => {
    expect(adversaryLabel(null, "rest_of_world", "India-linked APT hits banks")).toBe(
      "UNID TIGER",
    );
    expect(adversaryLabel(null, "rest_of_world", "A Turkish espionage group")).toBe(
      "UNID WOLF",
    );
    expect(
      adversaryLabel(null, "rest_of_world", "Vietnamese actor targets dissidents"),
    ).toBe("UNID BUFFALO");
    expect(adversaryLabel(null, "rest_of_world", "unknown origin")).toBe("UNID BAT");
  });

  it("prefers the country on the row to the words in the report", () => {
    // The card is grouped by the stored country, so the label has to agree with
    // it: an India-carded report whose summary never says "India" was landing
    // on the card as UNID BAT.
    expect(adversaryLabel(null, "rest_of_world", "no country named", "India")).toBe(
      "UNID TIGER",
    );
    // ... and a mention of another country in the prose no longer wins.
    expect(
      adversaryLabel(null, "rest_of_world", "attacks on Indian banks", "Pakistan"),
    ).toBe("UNID LEOPARD");
    expect(adversaryLabel(null, "rest_of_world", "", "South Korea")).toBe(
      "UNID CRANE",
    );
  });
});
