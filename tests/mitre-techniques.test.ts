import { describe, it, expect } from "vitest";
import { techniqueInfo, techniqueTooltip } from "@/lib/mitre/techniques";

describe("techniqueInfo", () => {
  it("looks up a known technique", () => {
    expect(techniqueInfo("T1059")?.name).toBe("Command and Scripting Interpreter");
  });

  it("looks up a known sub-technique directly", () => {
    expect(techniqueInfo("T1059.001")?.name).toBe("PowerShell");
  });

  it("falls back to the parent for an unknown sub-technique", () => {
    // T1566.003 is not in the map; should resolve to T1566 (Phishing).
    expect(techniqueInfo("T1566.003")?.name).toBe("Phishing");
  });

  it("returns null for a fully unknown code", () => {
    expect(techniqueInfo("T9999")).toBeNull();
  });
});

describe("techniqueTooltip", () => {
  it("formats name and description", () => {
    expect(techniqueTooltip("T1113")).toBe(
      "Screen Capture - Takes screenshots of the victim's display.",
    );
  });

  it("gives a generic tooltip for unknown codes", () => {
    expect(techniqueTooltip("T9999")).toBe("MITRE ATT&CK technique T9999");
  });
});
