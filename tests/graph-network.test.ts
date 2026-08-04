import { describe, it, expect } from "vitest";
import { collapseToPairs, edgeWidth, type EntityLink } from "@/lib/graph/network";

const link = (itemId: string, entityId: string): EntityLink => ({
  itemId,
  entityId,
});

describe("collapseToPairs", () => {
  it("collapses several shared entities into one weighted connection", () => {
    // A and B share three indicators; that is ONE edge of strength 3, not three
    // edges - the whole point of this view.
    const { edges } = collapseToPairs([
      link("A", "e1"), link("B", "e1"),
      link("A", "e2"), link("B", "e2"),
      link("A", "e3"), link("B", "e3"),
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0].weight).toBe(3);
  });

  it("ignores an entity only one report references", () => {
    const { edges, linked } = collapseToPairs([
      link("A", "solo1"), link("A", "solo2"), link("B", "solo3"),
    ]);
    expect(edges).toEqual([]);
    expect(linked.size).toBe(0);
  });

  it("reports only the connected items, so isolates can be dropped", () => {
    const { linked } = collapseToPairs([
      link("A", "e1"), link("B", "e1"), link("C", "own"),
    ]);
    expect([...linked].sort()).toEqual(["A", "B"]);
    expect(linked.has("C")).toBe(false);
  });

  it("connects every pair an entity is shared by", () => {
    // Three reports on one indicator is a triangle: A-B, A-C, B-C.
    const { edges } = collapseToPairs([
      link("A", "e"), link("B", "e"), link("C", "e"),
    ]);
    expect(edges).toHaveLength(3);
    expect(edges.every((e) => e.weight === 1)).toBe(true);
  });

  it("gives the same edge id whichever way round the pair is built", () => {
    const one = collapseToPairs([link("A", "e"), link("B", "e")]).edges[0];
    const other = collapseToPairs([link("B", "e"), link("A", "e")]).edges[0];
    expect(one.id).toBe(other.id);
  });

  it("drops an indicator shared too widely to mean anything", () => {
    // 5 reports on one entity is 10 pairs; with maxFanout 4 it contributes none.
    const links = ["A", "B", "C", "D", "E"].map((i) => link(i, "everywhere"));
    const { edges, dropped } = collapseToPairs(links, 4);
    expect(edges).toEqual([]);
    expect(dropped).toEqual(["everywhere"]);
  });

  it("keeps an indicator exactly at the fan-out limit", () => {
    const links = ["A", "B", "C", "D"].map((i) => link(i, "common"));
    const { edges, dropped } = collapseToPairs(links, 4);
    expect(dropped).toEqual([]);
    expect(edges).toHaveLength(6); // 4 choose 2
  });

  it("counts a duplicated link once, not twice", () => {
    // The same report/entity row appearing twice must not inflate strength.
    const { edges } = collapseToPairs([
      link("A", "e"), link("A", "e"), link("B", "e"),
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0].weight).toBe(1);
  });
});

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
