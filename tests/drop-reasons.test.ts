import { describe, it, expect } from "vitest";
import {
  dropReasonCategory,
  summariseDropReasons,
  DROP_CATEGORY_ORDER,
} from "@/lib/drop-reasons";

describe("dropReasonCategory", () => {
  it("recognises the fixed pre-gate reasons", () => {
    expect(dropReasonCategory("missing title or URL")).toBe("incomplete");
    expect(dropReasonCategory("marketing / product (pre-gate)")).toBe("marketing");
    expect(dropReasonCategory("low-signal crew mention")).toBe("low_signal");
  });

  it("groups the LLM catch-all, which dominates in practice", () => {
    // 537 of 539 local drops carry exactly this string.
    expect(dropReasonCategory("LLM: not intelligence")).toBe("not_intelligence");
  });

  it("keeps a model's own explanation separate from the catch-all", () => {
    expect(
      dropReasonCategory(
        "screened out: This is vendor self-promotion and thought-leadership content",
      ),
    ).toBe("screened");
    expect(dropReasonCategory("LLM: a conference announcement, not reporting")).toBe(
      "screened",
    );
  });

  it("prefers the specific reason over a stray word in model prose", () => {
    // The drop was decided on the crew mention; "marketing" merely appears in
    // the sentence. Charting it as marketing would misattribute the cause.
    expect(
      dropReasonCategory("low-signal crew mention in a marketing round-up"),
    ).toBe("low_signal");
  });

  it("copes with nothing recorded", () => {
    expect(dropReasonCategory(null)).toBe("other");
    expect(dropReasonCategory("")).toBe("other");
    expect(dropReasonCategory("   ")).toBe("other");
  });

  it("is case-insensitive", () => {
    expect(dropReasonCategory("MISSING TITLE OR URL")).toBe("incomplete");
    expect(dropReasonCategory("llm: not intelligence")).toBe("not_intelligence");
  });
});

describe("summariseDropReasons", () => {
  it("counts by category in display order", () => {
    const out = summariseDropReasons([
      "LLM: not intelligence",
      "LLM: not intelligence",
      "marketing / product (pre-gate)",
      "missing title or URL",
    ]);
    expect(out.map((o) => [o.category, o.count])).toEqual([
      ["not_intelligence", 2],
      ["marketing", 1],
      ["incomplete", 1],
    ]);
  });

  it("omits categories with nothing in them, so the chart has no empty slices", () => {
    const out = summariseDropReasons(["LLM: not intelligence"]);
    expect(out).toHaveLength(1);
    expect(out.length).toBeLessThan(DROP_CATEGORY_ORDER.length);
  });

  it("gives every slice a label and a colour", () => {
    for (const slice of summariseDropReasons(["a", "missing title or URL"])) {
      expect(slice.label).toBeTruthy();
      expect(slice.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("returns nothing for a feed that has dropped nothing", () => {
    expect(summariseDropReasons([])).toEqual([]);
  });
});
