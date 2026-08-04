"use client";

import { useState, useTransition } from "react";
import { usePaginated, PaginationFooter } from "@/components/Pagination";
import { formatDateTime } from "@/lib/format";
import {
  keepFlaggedIndicator,
  removeFlaggedIndicator,
} from "@/app/settings/review-actions";

export type ReviewFlag = {
  id: string;
  value: string;
  iocType: string;
  category: string;
  reason: string;
  reports: number;
  flaggedAt: string;
};

export type ReviewStatus = {
  ranAt: string | null;
  candidates: number;
  flagged: number;
  model: string | null;
  error: string | null;
};

/** The host an allowlist entry would cover, so the consequence is on screen. */
function allowlistPreview(value: string, iocType: string): string | null {
  if (iocType === "domain" || iocType === "ip") return value;
  if (iocType === "uri") {
    try {
      return new URL(value).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  }
  return null;
}

export function ReviewPanel({
  initial,
  status,
}: {
  initial: ReviewFlag[];
  status: ReviewStatus | null;
}) {
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const p = usePaginated(rows, 20);

  function act(id: string, remove: boolean) {
    setError(null);
    startTransition(async () => {
      const res = remove
        ? await removeFlaggedIndicator(id)
        : await keepFlaggedIndicator(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRows((cur) => cur.filter((r) => r.id !== id));
    });
  }

  return (
    <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-4">
      <h2 className="text-[13px] font-semibold text-slate-900">
        Suspect indicators ({rows.length})
      </h2>
      <p className="mt-0.5 text-[11px] text-slate-500">
        Each ingest run asks a model to look over the indicators that join two or
        more reports together, and flags any that do not look like attacker
        infrastructure - a vendor advisory page, a publisher&apos;s own social
        links, a version number read as an IP. These are suggestions only:
        nothing is deleted until you say so.
      </p>

      {status ? (
        <p className="mt-1 text-[10px] text-slate-400">
          {status.ranAt
            ? `Last checked ${formatDateTime(status.ranAt)} - ${status.flagged} flagged of ${status.candidates} reviewed${status.model ? ` (${status.model})` : ""}.`
            : "Not checked yet."}
          {status.error ? ` Last run failed: ${status.error}` : ""}
        </p>
      ) : null}

      {error ? (
        <p className="mt-2 rounded-md bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
          {error}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-4 text-[12px] text-slate-400">
          Nothing flagged. Indicators judged legitimate are not raised again.
        </p>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-[#e5e7eb] text-left text-[10px] uppercase tracking-wide text-slate-400">
                  <th className="py-1.5 pr-3 font-medium">Indicator</th>
                  <th className="py-1.5 pr-3 font-medium">Type</th>
                  <th className="py-1.5 pr-3 font-medium">Reports</th>
                  <th className="py-1.5 pr-3 font-medium">Flagged</th>
                  <th className="py-1.5 font-medium">Action</th>
                </tr>
              </thead>
              {p.pageItems.map((f) => {
                const allow = allowlistPreview(f.value, f.iocType);
                return (
                  <tbody key={f.id} className="align-top">
                    <tr>
                      <td className="break-all py-1.5 pr-3 font-mono text-[11px] text-slate-800">
                        {f.value}
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-3 text-slate-500">
                        {f.iocType}
                      </td>
                      <td className="py-1.5 pr-3 text-slate-500">{f.reports}</td>
                      <td className="whitespace-nowrap py-1.5 pr-3 text-slate-500">
                        {formatDateTime(f.flaggedAt)}
                      </td>
                      <td className="whitespace-nowrap py-1.5">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => act(f.id, true)}
                          className="rounded-md bg-rose-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                        >
                          Remove
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => act(f.id, false)}
                          className="ml-1.5 rounded-md border border-[#e5e7eb] px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Keep
                        </button>
                      </td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td colSpan={5} className="pb-2 text-[11px] text-slate-500">
                        <span className="mr-1 rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-600">
                          {f.category}
                        </span>
                        {f.reason}
                        {allow ? (
                          <span className="ml-1 text-slate-400">
                            Removing also allowlists {allow}, so it is not
                            re-ingested.
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  </tbody>
                );
              })}
            </table>
          </div>
          <PaginationFooter {...p} />
        </>
      )}
    </section>
  );
}
