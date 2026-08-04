"use client";

import { useMemo, useState, useTransition } from "react";
import { usePaginated, PaginationFooter } from "@/components/Pagination";
import { formatDateTime } from "@/lib/format";
import {
  keepFlaggedIndicators,
  removeFlaggedIndicators,
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
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  // Which bulk action is one click from firing on everything.
  const [armed, setArmed] = useState<"remove" | "keep" | null>(null);
  const [pending, startTransition] = useTransition();
  const p = usePaginated(rows, 20);

  // Selecting nothing means "everything": the buttons say so, and this is what
  // they act on either way.
  const targets = useMemo(
    () => (selected.size > 0 ? rows.filter((r) => selected.has(r.id)) : rows),
    [rows, selected],
  );
  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggle(id: string) {
    setArmed(null);
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setArmed(null);
    setSelected((cur) =>
      cur.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)),
    );
  }

  function act(remove: boolean) {
    const ids = targets.map((t) => t.id);
    if (ids.length === 0) return;
    // Confirm only when acting on everything by default. An explicit tick is a
    // deliberate choice; "Remove All" is otherwise one click from deleting every
    // flagged indicator and allowlisting each one, which is not easily undone.
    // Two clicks on the button itself rather than a dialog, so the warning names
    // what is about to happen and sits where the action is.
    const key = remove ? "remove" : "keep";
    if (selected.size === 0 && ids.length > 1 && armed !== key) {
      setArmed(key);
      setError(null);
      return;
    }
    setArmed(null);
    setError(null);
    startTransition(async () => {
      const res = remove
        ? await removeFlaggedIndicators(ids)
        : await keepFlaggedIndicators(ids);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const done = new Set(ids);
      setRows((cur) => cur.filter((r) => !done.has(r.id)));
      setSelected(new Set());
    });
  }

  const suffix = selected.size > 0 ? `Selected (${selected.size})` : "All";

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
          <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-[#e5e7eb] pb-2">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
              <input
                type="checkbox"
                checked={allSelected}
                // Some but not all: neither ticked nor empty is the honest state.
                ref={(el) => {
                  if (el) el.indeterminate = selected.size > 0 && !allSelected;
                }}
                onChange={toggleAll}
                aria-label="Select all flagged indicators"
              />
              Select all
            </label>
            <span
              className={`text-[11px] ${armed ? "font-medium text-rose-700" : "text-slate-400"}`}
            >
              {armed === "remove"
                ? `Click Remove All again to delete and allowlist all ${rows.length}.`
                : armed === "keep"
                  ? `Click Keep All again to clear all ${rows.length}.`
                  : selected.size > 0
                    ? `${selected.size} selected`
                    : "none selected - the buttons act on all of them"}
            </span>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => act(true)}
                className="rounded-md bg-rose-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-rose-700 disabled:opacity-50"
              >
                Remove {suffix}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => act(false)}
                className="rounded-md border border-[#e5e7eb] px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Keep {suffix}
              </button>
            </div>
          </div>

          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-[#e5e7eb] text-left text-[10px] uppercase tracking-wide text-slate-400">
                  <th className="w-6 py-1.5 pr-2 font-medium" />
                  <th className="py-1.5 pr-3 font-medium">Indicator</th>
                  <th className="py-1.5 pr-3 font-medium">Type</th>
                  <th className="py-1.5 pr-3 font-medium">Reports</th>
                  <th className="py-1.5 pr-3 font-medium">Flagged</th>
                </tr>
              </thead>
              {p.pageItems.map((f) => {
                const allow = allowlistPreview(f.value, f.iocType);
                return (
                  <tbody key={f.id} className="align-top">
                    <tr>
                      <td className="py-1.5 pr-2">
                        <input
                          type="checkbox"
                          checked={selected.has(f.id)}
                          onChange={() => toggle(f.id)}
                          aria-label={`Select ${f.value}`}
                        />
                      </td>
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
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td />
                      <td colSpan={4} className="pb-2 text-[11px] text-slate-500">
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
