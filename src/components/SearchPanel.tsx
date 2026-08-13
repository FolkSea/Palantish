"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { searchDashboard, type SearchResults } from "@/app/actions";
import { ReportTable } from "@/components/ReportTable";

/**
 * The header's search box. Results and the syntax reference open as a layer over
 * the page rather than in the flow, because the box now lives on every page and
 * pushing the content down on each keystroke would be intolerable.
 */
export function SearchPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [open, setOpen] = useState(true);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  // Dismiss the layer the way any popup should: click away, or press Escape.
  // The query is kept, so focusing the box brings the same results back.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const timer = setTimeout(() => {
      startTransition(async () => {
        setResults(await searchDashboard(q));
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const active = query.trim().length >= 2;
  const total = results
    ? results.reports.length + results.breaches.length + results.vulns.length
    : 0;

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search, or query: label:Malware AND adv:&quot;FANCY BEAR&quot;"
          aria-label="Search"
          className="w-full rounded-[10px] border border-[#e5e7eb] bg-white py-2 pl-9 pr-9 text-[13px] text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
        />
        <button
          type="button"
          onClick={() => setShowHelp((h) => !h)}
          aria-expanded={showHelp}
          title="Query syntax"
          aria-label="Query syntax"
          className={`absolute ${query ? "right-8" : "right-2.5"} top-1/2 -translate-y-1/2 rounded px-1 text-[11px] font-semibold ${
            showHelp
              ? "bg-slate-200 text-slate-700"
              : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          }`}
        >
          ?
        </button>
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        ) : null}
      </div>

      {/* One layer for the reference and the results, over the page. */}
      {showHelp || (active && open) ? (
        <div className="absolute left-0 right-0 top-full z-40 mt-1.5 max-h-[75vh] overflow-y-auto rounded-[10px] border border-[#e5e7eb] bg-white shadow-xl">
          {showHelp ? (
            <QueryHelp
              onPick={(q) => {
                setQuery(q);
                setOpen(true);
              }}
            />
          ) : null}
          {active && open ? (
        <div className="p-4">
          {results?.error && !pending ? (
            <p className="text-[12px] font-medium text-red-600">{results.error}</p>
          ) : (
            <p className="text-[11px] uppercase tracking-wide text-slate-400">
              {/* While a search is in flight the previous count is stale, and
                  pairing it with the new query text reads as a real answer. */}
              {pending
                ? "Searching..."
                : `${total} result${total === 1 ? "" : "s"} for "${query.trim()}"`}
            </p>
          )}
          {results?.truncated && !results.error && !pending ? (
            <p className="mt-1 text-[11px] text-amber-700">
              Searched the most recent reports only; older ones were not covered.
            </p>
          ) : null}

          {results && !results.error && !pending ? (
            <div className="mt-3 space-y-3">
              <ReportTable title="Reports" items={results.reports} empty="No matches." />
              <ReportTable title="Breaches" items={results.breaches} empty="No matches." />
              <ReportTable
                title="Exploits and Vulnerabilities"
                items={results.vulns}
                empty="No matches."
              />
            </div>
          ) : null}
        </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function QueryHelp({ onPick }: { onPick: (query: string) => void }) {
  const fields: [string, string][] = [
    ["label:", "Malware/ZimReaper, Target/Zimbra, AI/Claude"],
    ["adv: / actor:", "attributed adversary, either spelling"],
    ["ttp: / mitre:", "ATT&CK technique, e.g. T1059.001"],
    ["cve:", "CVE id, on the report or its indicators"],
    ["ip: dom: hash:", "indicators by type; defanged input is fine"],
    ["ioc:", "any indicator, whatever its type"],
    ["src:", "source feed name"],
    ["(bare words)", "title, summary and affected product"],
  ];
  const examples = [
    'label:Target/Zimbra AND adv:"FANCY BEAR"',
    "(ip:192.168 OR dom:evil) NOT label:AI/Claude",
    "label:Malware/* -src:Reddit",
    "dom:~\\.(ru|su)$",
  ];
  return (
    <div className="border-b border-[#e5e7eb] bg-slate-50 p-3 text-[12px]">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {fields.map(([name, hint]) => (
          <div key={name} className="contents">
            <dt className="font-mono text-[11px] text-slate-700">{name}</dt>
            <dd className="text-slate-500">{hint}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-slate-500">
        Combine with <Op>AND</Op> <Op>OR</Op> <Op>NOT</Op> (or <Op>-</Op>) and
        brackets; adjacent terms are an implicit AND. Quote values with spaces.
        A value matches anywhere in the field, or use <Op>*</Op> as a wildcard to
        anchor it: <Op>Malware/*</Op> is that branch, <Op>*BEAR</Op> ends with it.
        Use <Op>:~</Op> instead of <Op>:</Op> for a regular expression.
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {examples.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onPick(e)}
            className="rounded border border-[#e5e7eb] bg-white px-1.5 py-0.5 font-mono text-[11px] text-[#1d4ed8] hover:bg-slate-100"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

function Op({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-slate-200 px-1 font-mono text-[11px] text-slate-700">
      {children}
    </code>
  );
}
