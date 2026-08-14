"use client";

import { useState } from "react";
import Link from "next/link";
import { usePaginated, PaginationFooter } from "@/components/Pagination";
import { formatDateTime } from "@/lib/format";
import { itemHref } from "@/lib/browse-links";
import { markReportReviewedAction } from "@/app/actions";

export type UnclassifiedReport = {
  rawHash: string;
  title: string;
  url: string | null;
  sourceName: string | null;
  publishedAt: string | null;
  createdAt: string;
};

/**
 * The reports the classifier never read.
 *
 * Under llm-first the deterministic rules only run when a triage call fails, so
 * these arrived with no labels, no adversary and no nexus. Nothing about them
 * looks wrong on the dashboard - they simply say nothing - and they match no
 * subscription, so without this list the only sign they exist is a number in a
 * notification.
 *
 * A report leaves the list when it has been read: AI Magic on the report
 * itself, or Reviewed here for one that needs nothing.
 */
export function UnclassifiedPanel({ initial }: { initial: UnclassifiedReport[] }) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const p = usePaginated(rows, 25);

  async function markReviewed(rawHash: string) {
    setBusy(rawHash);
    setError(null);
    const res = await markReportReviewedAction(rawHash);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setRows((cur) => cur.filter((r) => r.rawHash !== rawHash));
  }

  return (
    <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-4">
      <h2 className="text-[13px] font-semibold text-slate-900">
        Stored unclassified ({rows.length})
      </h2>
      <p className="mt-0.5 text-[11px] text-slate-500">
        Reports the triage call could not read - usually a timeout - so they came
        in with no labels, adversary or nexus. Open one and use AI Magic to have
        it read properly, or mark it reviewed if it needs nothing. Newest first.
      </p>

      {error ? (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
          {error}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-4 text-[12px] text-slate-400">
          Nothing is waiting: every report has been classified.
        </p>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="w-px whitespace-nowrap py-1.5 pr-3 font-medium">
                    Arrived (UTC)
                  </th>
                  <th className="w-px whitespace-nowrap py-1.5 pr-3 font-medium">
                    Source
                  </th>
                  <th className="py-1.5 pr-3 font-medium">Report</th>
                  <th className="w-px py-1.5 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {p.pageItems.map((r) => (
                  <tr key={r.rawHash} className="border-t border-slate-100 align-top">
                    <td className="w-px whitespace-nowrap py-2 pr-3 text-slate-500">
                      {formatDateTime(r.createdAt)}
                    </td>
                    <td className="w-px whitespace-nowrap py-2 pr-3 text-slate-500">
                      {r.sourceName ?? "-"}
                    </td>
                    <td className="py-2 pr-3">
                      <Link
                        href={itemHref(r.rawHash)}
                        className="font-medium text-[#1d4ed8] hover:underline"
                      >
                        {r.title}
                      </Link>
                    </td>
                    <td className="w-px whitespace-nowrap py-2 text-right">
                      <button
                        type="button"
                        onClick={() => markReviewed(r.rawHash)}
                        disabled={busy === r.rawHash}
                        className="rounded-md border border-[#e5e7eb] bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {busy === r.rawHash ? "Saving..." : "Reviewed"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationFooter {...p} />
        </>
      )}
    </section>
  );
}
