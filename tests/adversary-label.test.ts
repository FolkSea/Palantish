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
    expect(adversaryLabel(null, "russia")).toBe("UNID Bear");
    expect(adversaryLabel(null, "china")).toBe("UNID Panda");
    expect(adversaryLabel(null, "iran")).toBe("UNID Kitten");
    expect(adversaryLabel(null, "north_korea")).toBe("UNID Chollima");
    expect(adversaryLabel(null, "rest_of_world")).toBe("UNID Bat");
    expect(adversaryLabel(null, "other")).toBe("UNID Spider");
  });

  it("promotes bare-animal and UNKNOWN values to UNID <animal>", () => {
    expect(adversaryLabel("Bear", "russia")).toBe("UNID Bear");
    expect(adversaryLabel("Kitten", "iran")).toBe("UNID Kitten");
    expect(adversaryLabel("UNKNOWN", "china")).toBe("UNID Panda");
  });
});
