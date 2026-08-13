import { describe, it, expect } from "vitest";
import { edgeWidth } from "@/lib/graph/network";

// Pair collapsing moved into the report_network database function, which
// vitest cannot reach. Its equivalence with the implementation these tests
// used to cover was checked against the real corpus - 7,951 links, identical
// pairs and weights at four fan-out thresholds - and the migration records it.


describe("edgeWidth", () => {
  it("spans the full range from weakest to strongest", () => {
    expect(edgeWidth(1, 100)).toBe(1);
    expect(edgeWidth(100, 100)).toBe(8);
  });

  it("keeps a mid-strength link visibly thicker than a single-share one", () => {
    // Square-root scaling: with a linear scale a strength of 10 against a max of
    // 500 would be within a hair of the minimum and read as unconnected.
    expect(edgeWidth(10, 500)).toBeGreaterThan(edgeWidth(1, 500) + 0.5);
  });

  it("does not divide by zero when everything shares one indicator", () => {
    expect(Number.isFinite(edgeWidth(1, 1))).toBe(true);
    expect(edgeWidth(1, 1)).toBe(1);
  });
});
