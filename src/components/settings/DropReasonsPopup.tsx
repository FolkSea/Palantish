"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Pie } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, type TooltipItem } from "chart.js";
import {
  dropSummaryForSource,
  type DropSummaryResult,
} from "@/app/settings/drop-actions";
import type { DropBreakdown } from "@/lib/drop-reasons";

// Only what a pie needs. The timeline registers its own scales separately;
// chart.js keeps one global registry, so registering twice is harmless.
ChartJS.register(ArcElement, Tooltip);

/**
 * Why a feed's candidates were dropped.
 *
 * Opens from the kept/dropped cell, because that is where the question occurs -
 * "0 kept of 80" invites exactly this, and the answer was previously only
 * reachable by opening the Dropped panel and reading for the feed's name.
 */
export function DropReasonsPopup({
  sourceName,
  droppedTally,
  onClose,
}: {
  sourceName: string;
  /** The feed's running posts_dropped, for the footnote when it differs. */
  droppedTally: number;
  onClose: () => void;
}) {
  const [result, setResult] = useState<DropSummaryResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    dropSummaryForSource(sourceName).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [sourceName]);

  // Dismiss the way any popup should: click away, or press Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const breakdown: DropBreakdown[] =
    result?.ok && result.breakdown.length > 0 ? result.breakdown : [];
  const total = result?.ok ? result.total : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-[10px] border border-[#e5e7eb] bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Why ${sourceName} candidates were dropped`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-semibold text-slate-900">
              Dropped from {sourceName}
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Why this feed&apos;s candidates did not become reports.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {result === null ? (
          <p className="py-8 text-center text-[12px] text-slate-400">Loading...</p>
        ) : !result.ok ? (
          <p className="py-8 text-center text-[12px] text-rose-600">{result.error}</p>
        ) : breakdown.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-slate-400">
            Nothing recorded as dropped for this feed.
          </p>
        ) : (
          <>
            <div className="mx-auto mt-3 h-44 w-44">
              <Pie
                data={{
                  labels: breakdown.map((b) => b.label),
                  datasets: [
                    {
                      data: breakdown.map((b) => b.count),
                      backgroundColor: breakdown.map((b) => b.color),
                      borderColor: "#fff",
                      borderWidth: 2,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    // The legend below carries the counts, so the built-in one
                    // would only repeat the labels in less space.
                    legend: { display: false },
                    tooltip: {
                      callbacks: {
                        label: (item: TooltipItem<"pie">) => {
                          const value = Number(item.raw ?? 0);
                          const pct = total ? Math.round((value / total) * 100) : 0;
                          return `${item.label}: ${value} (${pct}%)`;
                        },
                      },
                    },
                  },
                }}
              />
            </div>

            <ul className="mt-3 space-y-1">
              {breakdown.map((b) => (
                <li
                  key={b.category}
                  className="flex items-center gap-2 text-[11px] text-slate-600"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: b.color }}
                    aria-hidden="true"
                  />
                  <span className="flex-1">{b.label}</span>
                  <span className="font-medium text-slate-800">{b.count}</span>
                  <span className="w-9 text-right text-slate-400">
                    {total ? Math.round((b.count / total) * 100) : 0}%
                  </span>
                </li>
              ))}
            </ul>

            {total !== droppedTally ? (
              // The two numbers genuinely measure different things, and a
              // silent disagreement inside one popup reads as a bug.
              <p className="mt-2 text-[10px] leading-tight text-slate-400">
                {total} candidates recorded. The feed&apos;s tally of{" "}
                {droppedTally} counts every run in which something was dropped,
                so a candidate dropped again next run is counted twice there and
                once here.
              </p>
            ) : null}

            <Link
              href={`/settings?tab=dropped&source=${encodeURIComponent(sourceName)}`}
              className="mt-3 flex items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-slate-700"
            >
              See all {total} dropped report{total === 1 ? "" : "s"}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
