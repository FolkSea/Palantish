"use client";

import { usePaginated, PaginationFooter } from "@/components/Pagination";
import { formatDate } from "@/lib/format";

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
          <ul className="mt-3 divide-y divide-slate-100">
            {p.pageItems.map((d) => (
              <li
                key={d.rawHash}
                className="flex items-start gap-3 py-2 text-[12px]"
              >
                <span className="flex-1">
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
                  <span className="mt-0.5 block text-[11px] text-slate-400">
                    {d.sourceName ? `${d.sourceName} - ` : ""}
                    {formatDate(d.droppedAt)}
                  </span>
                </span>
                {d.reason ? (
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                    {d.reason}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <PaginationFooter {...p} />
        </>
      )}
    </section>
  );
}
