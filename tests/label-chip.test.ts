import { describe, it, expect } from "vitest";
import { labelChipClass } from "@/lib/badges";

describe("labelChipClass", () => {
  it("colours each taxonomy category", () => {
    expect(labelChipClass("Adversary/FancyBear")).toContain("red");
    expect(labelChipClass("Target/Zimbra")).toContain("emerald");
    expect(labelChipClass("Malware/FlyingEagle")).toContain("pink");
    expect(labelChipClass("AI/Claude")).toContain("orange");
  });

  it("matches the prefix case-insensitively", () => {
    expect(labelChipClass("adversary/x")).toBe(labelChipClass("Adversary/X"));
    expect(labelChipClass("MALWARE/x")).toContain("pink");
  });

  it("falls back to neutral for an unknown or hand-typed label", () => {
    expect(labelChipClass("Priority/High")).toContain("slate");
    expect(labelChipClass("just-a-label")).toContain("slate");
    expect(labelChipClass("")).toContain("slate");
  });

  it("does not confuse a value that contains a category name", () => {
    // The prefix decides, not the value.
    expect(labelChipClass("Target/AdversaryTracker")).toContain("emerald");
  });
});
