import { describe, it, expect } from "vitest";
import { pageOf, CARD_PAGE_SIZE, DEFAULT_PAGE_SIZE } from "@/lib/page";

const rows = Array.from({ length: 23 }, (_, i) => i);

describe("pageOf", () => {
  it("takes the page-th slice and reports the whole count", () => {
    expect(pageOf(rows, 0, 10)).toEqual({ rows: [0,1,2,3,4,5,6,7,8,9], total: 23 });
    expect(pageOf(rows, 2, 10)).toEqual({ rows: [20, 21, 22], total: 23 });
  });

  // The footer's "All". The reader asked for it, so they get it.
  it("returns everything for a null size", () => {
    expect(pageOf(rows, 0, null)).toEqual({ rows, total: 23 });
  });

  it("is empty past the end rather than wrapping round", () => {
    expect(pageOf(rows, 9, 10)).toEqual({ rows: [], total: 23 });
  });

  // The page number reaches the server from a POST body.
  it("treats a nonsense page as the first one", () => {
    for (const page of [-1, -100, 0.5, NaN])
      expect(pageOf(rows, page, 5).rows).toEqual([0, 1, 2, 3, 4]);
  });

  it("counts an empty list without claiming a page of it", () => {
    expect(pageOf([], 0, DEFAULT_PAGE_SIZE)).toEqual({ rows: [], total: 0 });
    expect(CARD_PAGE_SIZE).toBeLessThan(DEFAULT_PAGE_SIZE);
  });
});
