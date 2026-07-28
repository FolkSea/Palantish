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

/** Client-side pagination over an already-loaded array. */
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

const btn =
  "rounded border border-[#e5e7eb] bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 enabled:hover:bg-slate-50 disabled:opacity-40";

/** Footer bar: "Showing a-b of N", a per-page selector, and prev/next. */
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
