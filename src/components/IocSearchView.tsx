"use client";

import { useState, useTransition } from "react";
import { ReportTable } from "@/components/ReportTable";
import { searchIocs, type IocSearchResults } from "@/app/ioc-search/actions";
import { IOC_TYPE_LABEL, MAX_IOC_TERMS } from "@/lib/ioc-search";

const PLACEHOLDER = `Paste anything with indicators in it, for example:

C2 at 45.61.136.5 and 104.192.108.0/22, staging on
hxxps://evil-update[.]example/panel, dropper
SHA256 44d88612fea8a8f36de82e1278abb02f...`;

/**
 * Search the corpus for every indicator in a block of pasted text.
 *
 * A textarea rather than a search box, because what an analyst has is rarely a
 * tidy list: it is an email, a spreadsheet column, or a paragraph out of
 * somebody else's report. The extraction is the same one that reads indicators
 * out of a report, so defanged values match stored ones without being cleaned
 * up first.
 *
 * Results are the ordinary report table, one per indicator, so every row
 * behaves the way a row does everywhere else - open, save, hide, share.
 */
export function IocSearchView() {
  const [text, setText] = useState("");
  const [results, setResults] = useState<IocSearchResults | null>(null);
  const [searched, setSearched] = useState("");
  const [pending, startTransition] = useTransition();

  function run() {
    const value = text.trim();
    if (!value || pending) return;
    setSearched(value);
    startTransition(async () => {
      setResults(await searchIocs(value));
    });
  }

  const found = results?.groups.filter((g) => g.reports.length > 0).length ?? 0;

  return (
    <>
      <div className="rounded-[10px] border border-[#e5e7eb] bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-slate-600">
            Indicators
          </span>
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // The submit shortcut a textarea needs: Enter is a newline here.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                run();
              }
            }}
            rows={8}
            placeholder={PLACEHOLDER}
            className="w-full resize-y rounded-md border border-[#e5e7eb] bg-white px-2.5 py-2 font-mono text-[12px] text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
          />
        </label>
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-400">
            IP addresses (including CIDR ranges), domains and file hashes, fanged
            or defanged. Up to {MAX_IOC_TERMS} per search.
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {text ? (
              <button
                type="button"
                onClick={() => {
                  setText("");
                  setResults(null);
                  setSearched("");
                }}
                className="text-[11px] text-slate-500 hover:text-slate-700"
              >
                Clear
              </button>
            ) : null}
            <button
              type="button"
              onClick={run}
              disabled={pending || !text.trim()}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-slate-700 disabled:opacity-60"
            >
              {pending ? "Searching..." : "Search"}
            </button>
          </div>
        </div>
      </div>

      {results?.error && !pending ? (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          {results.error}
        </p>
      ) : null}

      {results && !results.error ? (
        <div className="mt-4">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">
            {pending
              ? "Searching..."
              : `${results.groups.length} indicator${
                  results.groups.length === 1 ? "" : "s"
                } searched, ${found} seen in reporting`}
          </p>
          {results.overflow > 0 && !pending ? (
            <p className="mt-1 text-[11px] text-amber-700">
              {results.overflow} further indicator
              {results.overflow === 1 ? " was" : "s were"} found in that text and
              not searched. Paste them separately.
            </p>
          ) : null}

          <div className="mt-3 space-y-3">
            {results.groups.map((g) => (
              <ReportTable
                key={`${g.type}:${g.value}`}
                title={g.value}
                subtitle={`${IOC_TYPE_LABEL[g.type]} - ${g.reports.length} report${
                  g.reports.length === 1 ? "" : "s"
                }${g.truncated ? " (most recent shown)" : ""}`}
                items={g.reports}
                empty="Not seen in any report."
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* The text can be edited after a search; keeping the searched value in
          view stops the results reading as an answer to the new text. */}
      {results && searched !== text.trim() && !pending ? (
        <p className="mt-3 text-[11px] text-slate-400">
          Results are for the previous text. Search again to update them.
        </p>
      ) : null}
    </>
  );
}
