import { describe, it, expect } from "vitest";
import { adversaryLabel, isSpecificAdversary } from "@/lib/badges";

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
});
