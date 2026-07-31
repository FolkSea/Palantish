import { describe, it, expect } from "vitest";
import {
  composeBrief,
  selectBriefNotes,
  parseReflection,
  type MemoryNote,
} from "@/lib/agent/memory";

function note(p: Partial<MemoryNote>): MemoryNote {
  return {
    kind: "adversary",
    subject: "ACTOR",
    content: "note",
    mentions: 1,
    lastSeen: "2026-07-01T00:00:00Z",
    ...p,
  };
}

describe("composeBrief", () => {
  it("is empty on a cold start (no notes)", () => {
    expect(composeBrief([])).toBe("");
  });

  it("renders adversary and trend sections", () => {
    const brief = composeBrief([
      note({ kind: "adversary", subject: "FANCY BEAR", content: "Russia GRU." }),
      note({ kind: "trend", subject: "edge-device-exploitation", content: "VPN/firewall zero-days." }),
    ]);
    expect(brief).toContain("Known adversaries:");
    expect(brief).toContain("FANCY BEAR: Russia GRU.");
    expect(brief).toContain("Tracked trends:");
    expect(brief).toContain("edge-device-exploitation: VPN/firewall zero-days.");
  });
});

describe("selectBriefNotes", () => {
  it("caps and ranks by recency then mentions", () => {
    const notes: MemoryNote[] = [
      note({ subject: "OLD", lastSeen: "2026-01-01T00:00:00Z", mentions: 9 }),
      note({ subject: "NEW", lastSeen: "2026-07-10T00:00:00Z", mentions: 1 }),
      note({ subject: "MID", lastSeen: "2026-07-10T00:00:00Z", mentions: 5 }),
    ];
    const { adversaries } = selectBriefNotes(notes);
    // Same day: more mentions first; older day sorts last.
    expect(adversaries.map((a) => a.subject)).toEqual(["MID", "NEW", "OLD"]);
  });
});

describe("parseReflection", () => {
  it("parses adversary + trend updates from JSON (tolerating prose)", () => {
    const out = parseReflection(
      `Here you go:\n{"adversaries":[{"subject":"VOLT TYPHOON","content":"China; OT pre-positioning."}],"trends":[{"subject":"living-off-the-land","content":"LOTL across intrusions."}]}`,
    );
    expect(out).toEqual([
      { kind: "adversary", subject: "VOLT TYPHOON", content: "China; OT pre-positioning." },
      { kind: "trend", subject: "living-off-the-land", content: "LOTL across intrusions." },
    ]);
  });

  it("skips malformed entries and returns [] on non-JSON", () => {
    expect(parseReflection("no json here")).toEqual([]);
    const out = parseReflection(
      `{"adversaries":[{"subject":"X"},{"subject":"Y","content":"ok"}],"trends":"nope"}`,
    );
    expect(out).toEqual([{ kind: "adversary", subject: "Y", content: "ok" }]);
  });
});
