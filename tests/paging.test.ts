import { describe, it, expect } from "vitest";
import {
  fetchAllPages,
  fetchAllByIds,
  PAGE_SIZE,
  PAGE_WINDOW,
} from "@/lib/paging";

/**
 * A fake table of `total` rows that answers range requests the way PostgREST
 * does, and records every request it was asked for.
 */
function table(total: number) {
  const calls: [number, number][] = [];
  let inFlight = 0;
  let peakInFlight = 0;
  const fetch = async (from: number, to: number) => {
    calls.push([from, to]);
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    await Promise.resolve();
    inFlight -= 1;
    const rows: number[] = [];
    for (let i = from; i <= Math.min(to, total - 1); i++) rows.push(i);
    return { data: rows };
  };
  return { fetch, calls, peak: () => peakInFlight };
}

describe("fetchAllPages", () => {
  it("returns every row, once, in order", async () => {
    for (const total of [0, 1, 500, PAGE_SIZE, PAGE_SIZE + 1, PAGE_SIZE * 3 + 7]) {
      const t = table(total);
      const rows = await fetchAllPages(t.fetch);
      expect(rows).toEqual(Array.from({ length: total }, (_, i) => i));
    }
  });

  // The boundary that loses rows if the loop stops one page early: a table
  // whose size is an exact multiple of the page size has a full last page, so
  // the read only ends on the empty page after it.
  it("keeps reading past an exactly-full final page", async () => {
    for (const pages of [1, 2, PAGE_WINDOW, PAGE_WINDOW + 1]) {
      const rows = await fetchAllPages(table(PAGE_SIZE * pages).fetch);
      expect(rows).toHaveLength(PAGE_SIZE * pages);
      expect(new Set(rows).size).toBe(PAGE_SIZE * pages);
    }
  });

  // The common case, and the one a speculative window would have made worse:
  // most reads fit in a page, and must still cost exactly one request.
  it("costs a single request when everything fits in one page", async () => {
    for (const total of [0, 1, 200, PAGE_SIZE - 1]) {
      const t = table(total);
      await fetchAllPages(t.fetch);
      expect(t.calls.length).toBe(1);
    }
  });

  it("asks for the later pages concurrently, not one at a time", async () => {
    const t = table(PAGE_SIZE * 3);
    await fetchAllPages(t.fetch);
    expect(t.peak()).toBeGreaterThan(1);
    expect(t.calls[0]).toEqual([0, PAGE_SIZE - 1]);
  });

  it("spans more than one window when the table is bigger", async () => {
    const pages = PAGE_WINDOW + 3;
    const t = table(PAGE_SIZE * pages);
    const rows = await fetchAllPages(t.fetch);
    expect(rows).toEqual(Array.from({ length: PAGE_SIZE * pages }, (_, i) => i));
  });

  it("treats a null page as the end", async () => {
    const rows = await fetchAllPages(async () => ({ data: null }));
    expect(rows).toEqual([]);
  });

  // Pages beyond the short one are fetched speculatively and must be thrown
  // away: appending them would duplicate or reorder rows.
  it("discards anything fetched past the end", async () => {
    let n = 0;
    const rows = await fetchAllPages<number>(async () => {
      n += 1;
      // A full first page forces the window; the next is short and ends the
      // read, so the pages after it in the same window must be thrown away.
      if (n === 1) return { data: Array.from({ length: PAGE_SIZE }, (_, i) => i) };
      if (n === 2) return { data: [-1] };
      return { data: [-99] };
    });
    expect(rows).toHaveLength(PAGE_SIZE + 1);
    expect(rows.at(-1)).toBe(-1);
    expect(rows).not.toContain(-99);
  });
});

describe("fetchAllByIds", () => {
  it("returns the rows for every id, asking for each chunk once", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `id-${i}`);
    let requests = 0;
    const rows = await fetchAllByIds<string>(ids, async (chunk) => {
      requests += 1;
      return { data: chunk };
    });
    expect(rows.sort()).toEqual([...ids].sort());
    // 450 ids is three chunks, and no chunk fills a page - so three requests,
    // not three times a speculative window of them.
    expect(requests).toBe(3);
  });

  it("asks for nothing when there are no ids", async () => {
    let called = false;
    const rows = await fetchAllByIds<string>([], async (chunk) => {
      called = true;
      return { data: chunk };
    });
    expect(rows).toEqual([]);
    expect(called).toBe(false);
  });
});
