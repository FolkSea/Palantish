// One page of a list, and the arithmetic for taking it.
//
// Pure and dependency-free on purpose: the server slices the pages and the
// client renders them, so both sides need these and neither should have to
// import the other's module to get them.

/**
 * One page of a list, and how many rows there are in total.
 *
 * The dashboard reads a 90-day window but sends the reader ten rows of it:
 * the whole window in the browser was megabytes of report text nobody had
 * scrolled to. `total` is what the pager counts, so the footer still says
 * "1-10 of 340" without shipping the other 330.
 */
export type Page<T> = { rows: T[]; total: number };

/** Rows per page on first render; the reader can change it from the footer. */
export const DEFAULT_PAGE_SIZE = 10;

/** Actor cards are small and there are many, so they page five at a time. */
export const CARD_PAGE_SIZE = 5;

/** The page-th slice of `rows`. A null size means all of them. */
export function pageOf<T>(
  rows: T[],
  page: number,
  size: number | null,
): Page<T> {
  const total = rows.length;
  if (size === null) return { rows, total };
  // Anything that is not a page number is the first page. Math.max(0, NaN) is
  // NaN, not 0, and slicing by it silently yields nothing - a page request
  // that arrives malformed should show the list, not an empty one.
  const n = Math.trunc(Number(page));
  const start = Number.isFinite(n) && n > 0 ? n * size : 0;
  return { rows: rows.slice(start, start + size), total };
}
