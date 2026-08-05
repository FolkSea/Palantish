"use client";

import { useMemo, useState } from "react";

export type PageSize = number | "all";
const SIZES: PageSize[] = [10, 25, 50, "all"];

export type Paged<T> = {
  pageItems: T[];
  size: PageSize;
  setSize: (s: PageSize) => void;
  page: number;
  setPage: (p: number) => void;
  pageCount: number;
  total: number;
  start: number;
  end: number;
};

export function usePaginated<T>(items: T[], initial = 10): Paged<T> {
  const [size, setSizeRaw] = useState<PageSize>(initial);
  const [page, setPage] = useState(0);

  const total = items.length;
  const pageCount = size === "all" ? 1 : Math.max(1, Math.ceil(total / size));
  const clamped = Math.min(page, pageCount - 1);
  const start = size === "all" ? 0 : clamped * size;
  const end = size === "all" ? total : Math.min(total, start + size);

  const pageItems = useMemo(
    () => (size === "all" ? items : items.slice(start, end)),
    [items, size, start, end],
  );

  const setSize = (s: PageSize) => {
    setSizeRaw(s);
    setPage(0);
  };

  return { pageItems, size, setSize, page: clamped, setPage, pageCount, total, start, end };
}

/** One page from the server, and how many rows there are behind it. */
export type ServerPage<T> = { rows: T[]; total: number };

/**
 * The same pager, over a list the server holds.
 *
 * The dashboard reads a 90-day window but sends one page of it, so paging has
 * to ask rather than slice. The first page arrives with the page render; every
 * other one is fetched, and `loading` disables the controls while it is.
 *
 * Until the reader moves, the props win: a hidden or deleted item refreshes the
 * server render, and state held here would have gone on showing the old row.
 * Once they have paged, fetched data is the only thing that could be right.
 */
export function useServerPaginated<T>(
  first: ServerPage<T>,
  fetchPage: (page: number, size: number | null) => Promise<ServerPage<T>>,
  initial: PageSize = 10,
): Paged<T> & { loading: boolean } {
  const [size, setSizeState] = useState<PageSize>(initial);
  const [page, setPageState] = useState(0);
  const [fetched, setFetched] = useState<ServerPage<T> | null>(null);
  const [loading, setLoading] = useState(false);

  const pristine = page === 0 && size === initial;
  const view = pristine || !fetched ? first : fetched;

  async function go(nextPage: number, nextSize: PageSize) {
    setPageState(nextPage);
    setSizeState(nextSize);
    setLoading(true);
    try {
      setFetched(
        await fetchPage(nextPage, nextSize === "all" ? null : nextSize),
      );
    } finally {
      setLoading(false);
    }
  }

  const total = view.total;
  const pageCount = size === "all" ? 1 : Math.max(1, Math.ceil(total / size));
  const clamped = Math.min(page, pageCount - 1);
  const start = size === "all" ? 0 : clamped * size;

  return {
    pageItems: view.rows,
    size,
    setSize: (s: PageSize) => void go(0, s),
    page: clamped,
    setPage: (p: number) => void go(p, size),
    pageCount,
    total,
    start,
    end: Math.min(total, start + view.rows.length),
    loading,
  };
}

const btn =
  "rounded border border-[#e5e7eb] bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 enabled:hover:bg-slate-50 disabled:opacity-40";

export function PaginationFooter<T>(p: Paged<T>) {
  if (p.total === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
      <span>
        Showing {p.start + 1}-{p.end} of {p.total}
      </span>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1">
          <span>Per page</span>
          <select
            value={String(p.size)}
            onChange={(e) =>
              p.setSize(
                e.target.value === "all" ? "all" : Number(e.target.value),
              )
            }
            className="rounded border border-[#e5e7eb] bg-white px-1.5 py-0.5 text-[11px] text-slate-700"
          >
            {SIZES.map((s) => (
              <option key={String(s)} value={String(s)}>
                {s === "all" ? "All" : s}
              </option>
            ))}
          </select>
        </label>
        {p.pageCount > 1 ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={btn}
              disabled={p.page <= 0}
              onClick={() => p.setPage(p.page - 1)}
            >
              Prev
            </button>
            <span className="px-1">
              Page {p.page + 1} of {p.pageCount}
            </span>
            <button
              type="button"
              className={btn}
              disabled={p.page >= p.pageCount - 1}
              onClick={() => p.setPage(p.page + 1)}
            >
              Next
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
