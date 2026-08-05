import { describe, it, expect } from "vitest";
import {
  normalizeLabelValue,
  buildLabel,
  parseLabels,
} from "@/lib/agent/labels";

describe("normalizeLabelValue", () => {
  it("strips whitespace/punctuation and PascalCases each part", () => {
    expect(normalizeLabelValue("Flying Eagle")).toBe("FlyingEagle");
    expect(normalizeLabelValue("  zimbra  ")).toBe("Zimbra");
    expect(normalizeLabelValue("Cobalt-Strike")).toBe("CobaltStrike");
  });
  it("preserves inner casing so acronyms survive", () => {
    expect(normalizeLabelValue("OWA")).toBe("OWA");
    expect(normalizeLabelValue("ValleyRAT")).toBe("ValleyRAT");
  });
  it("returns empty for values with nothing usable", () => {
    expect(normalizeLabelValue("  ---  ")).toBe("");
    expect(normalizeLabelValue("")).toBe("");
  });
});

describe("buildLabel", () => {
  it("prefixes by category and normalises the value", () => {
    expect(buildLabel("ai", "Claude")).toBe("AI/Claude");
    expect(buildLabel("malware", "Flying Eagle")).toBe("Malware/FlyingEagle");
    expect(buildLabel("target", "zimbra")).toBe("Target/Zimbra");
    expect(buildLabel("adversary", "Fancy Bear")).toBe("Adversary/FancyBear");
  });
  it("strips a prefix the model already prepended", () => {
    expect(buildLabel("malware", "Malware/Flying Eagle")).toBe("Malware/FlyingEagle");
  });
  it("is null when the value is empty", () => {
    expect(buildLabel("target", "   ")).toBeNull();
  });
});

describe("parseLabels", () => {
  it("builds canonical labels from the structured triage object", () => {
    const out = parseLabels({
      malware: ["Flying Eagle"],
      adversary: ["Fancy Bear"],
      target: ["Zimbra", "OWA"],
      ai: ["Claude"],
    });
    expect(out).toEqual([
      "AI/Claude",
      "Malware/FlyingEagle",
      "Adversary/FancyBear",
      "Target/Zimbra",
      "Target/OWA",
    ]);
  });
  it("tolerates alternate keys, string values and dedupes case-insensitively", () => {
    const out = parseLabels({
      targets: "Zimbra",
      malware: ["ValleyRAT", "valleyrat"],
    });
    expect(out).toContain("Target/Zimbra");
    expect(out.filter((l) => l.toLowerCase() === "malware/valleyrat")).toHaveLength(1);
  });
  it("returns [] for missing/odd shapes", () => {
    expect(parseLabels(undefined)).toEqual([]);
    expect(parseLabels("nope")).toEqual([]);
    expect(parseLabels({})).toEqual([]);
  });
});

describe("Vector labels", () => {
  it("builds a SupplyChain label from the model's wording", () => {
    expect(buildLabel("vector", "supply chain")).toBe("Vector/SupplyChain");
    expect(buildLabel("vector", "SupplyChain")).toBe("Vector/SupplyChain");
  });

  it("lets the category govern the prefix the model prepends", () => {
    expect(buildLabel("vector", "Vector/SupplyChain")).toBe("Vector/SupplyChain");
    // The reported bug: a compromised product belongs under Target, and asking
    // for that category must not leave the model's "Adversary/" prefix on it.
    expect(buildLabel("target", "Adversary/QuickFox")).toBe("Target/QuickFox");
  });

  it("reads the vector key from the model's JSON", () => {
    const out = parseLabels({
      vector: ["SupplyChain"],
      target: ["QuickFox"],
      malware: ["FDMTP"],
    });
    expect(out).toContain("Vector/SupplyChain");
    expect(out).toContain("Target/QuickFox");
    expect(out).toContain("Malware/FDMTP");
  });

  it("ignores the category when the model omits it", () => {
    expect(parseLabels({ target: ["QuickFox"] })).toEqual(["Target/QuickFox"]);
  });
});
