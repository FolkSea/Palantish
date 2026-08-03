"use client";

import { usePaginated, PaginationFooter } from "@/components/Pagination";
import { formatDateTime } from "@/lib/format";

export type DroppedItem = {
  rawHash: string;
  title: string;
  url: string | null;
  sourceName: string | null;
  reason: string | null;
  droppedAt: string;
};

export function DroppedPanel({ initial }: { initial: DroppedItem[] }) {
  const p = usePaginated(initial, 25);

  return (
    <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-4">
      <h2 className="text-[13px] font-semibold text-slate-900">
        Dropped during ingest ({initial.length})
      </h2>
      <p className="mt-0.5 text-[11px] text-slate-500">
        Candidates the ingest pipeline filtered out (marketing, low-signal crew
        mentions, or LLM-rejected), newest first. Review these to confirm nothing
        useful is being dropped. Last 30 days.
      </p>

      {initial.length === 0 ? (
        <p className="mt-4 text-[12px] text-slate-400">
          Nothing has been dropped recently.
        </p>
      ) : (
        <>
          {/* A table, so every title starts at the same x however long the
              source name is. The reason spans the full width on its own row
              beneath, where it can wrap without moving the columns. */}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="w-px whitespace-nowrap py-1.5 pr-3 font-medium">
                    Dropped (UTC)
                  </th>
                  <th className="w-px whitespace-nowrap py-1.5 pr-3 font-medium">
                    Source
                  </th>
                  <th className="py-1.5 font-medium">Report</th>
                </tr>
              </thead>
              {p.pageItems.map((d) => (
                // One body per item, so the border separates items rather than
                // cutting between a report and its own reason.
                <tbody key={d.rawHash} className="border-t border-slate-100">
                  <tr className="align-top">
                    <td className="w-px whitespace-nowrap py-2 pr-3 text-slate-500">
                      {formatDateTime(d.droppedAt)}
                    </td>
                    <td className="w-px whitespace-nowrap py-2 pr-3 text-slate-500">
                      {d.sourceName ?? "-"}
                    </td>
                    <td className="py-2">
                      {d.url ? (
                        <a
                          href={d.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-slate-800 hover:underline"
                        >
                          {d.title}
                        </a>
                      ) : (
                        <span className="font-medium text-slate-800">{d.title}</span>
                      )}
                    </td>
                  </tr>
                  {d.reason ? (
                    <tr>
                      <td />
                      <td />
                      <td className="pb-2 text-[11px] leading-relaxed text-slate-500">
                        {d.reason}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              ))}
            </table>
          </div>
          <PaginationFooter {...p} />
        </>
      )}
    </section>
  );
}
