"use client";

import { useEffect, useState, useTransition } from "react";
import {
  searchDashboard,
  type SearchResults,
  type SearchReport,
  type SearchBreach,
  type SearchVuln,
} from "@/app/actions";
import { ReportTitle } from "@/components/ReportDetail";
import { SourceBadge, VulnStatusBadge } from "@/components/Badges";
import { sourceHref } from "@/lib/browse-links";
import { formatDate } from "@/lib/format";

export function SearchPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [pending, startTransition] = useTransition();

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
    <div>
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
          onChange={(e) => setQuery(e.target.value)}
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

      {showHelp ? <QueryHelp onPick={(q) => setQuery(q)} /> : null}

      {active ? (
        <div className="mt-3 rounded-[10px] border border-[#e5e7eb] bg-white p-4">
          {results?.error ? (
            <p className="text-[12px] font-medium text-red-600">{results.error}</p>
          ) : (
            <p className="text-[11px] uppercase tracking-wide text-slate-400">
              {pending && !results
                ? "Searching..."
                : `${total} result${total === 1 ? "" : "s"} for "${query.trim()}"`}
            </p>
          )}
          {results?.truncated && !results.error ? (
            <p className="mt-1 text-[11px] text-amber-700">
              Searched the most recent reports only; older ones were not covered.
            </p>
          ) : null}

          {results && !results.error ? (
            <div className="mt-3 space-y-4">
              <Section title="Reports" count={results.reports.length}>
                {results.reports.map((r) => (
                  <ReportRow key={r.id} r={r} />
                ))}
              </Section>
              <Section title="Breaches" count={results.breaches.length}>
                {results.breaches.map((b) => (
                  <BreachRow key={b.id} b={b} />
                ))}
              </Section>
              <Section
                title="Exploits and Vulnerabilities"
                count={results.vulns.length}
              >
                {results.vulns.map((v) => (
                  <VulnRow key={v.id} v={v} />
                ))}
              </Section>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold text-slate-900">
        {title}
        <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-medium text-slate-500">
          {count}
        </span>
      </h3>
      {count === 0 ? (
        <p className="text-[12px] text-slate-400">No matches.</p>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">{children}</ul>
      )}
    </section>
  );
}

function ReportRow({ r }: { r: SearchReport }) {
  return (
    <li className="flex items-start gap-2 text-[12px]">
      <span className="mt-0.5 shrink-0">
        <SourceBadge name={r.source_name} href={sourceHref(r.source_name ?? "")} />
      </span>
      <span className="flex-1">
        <ReportTitle
          report={{
            title: r.title,
            url: r.url,
            description: r.description,
            sourceName: r.source_name,
            date: r.published_at,
            rawHash: r.raw_hash,
          }}
        />
        {r.description ? (
          <span className="block truncate text-slate-500">{r.description}</span>
        ) : null}
      </span>
      <span className="shrink-0 text-[10px] text-slate-400">
        {r.published_at ? formatDate(r.published_at) : ""}
      </span>
    </li>
  );
}

function BreachRow({ b }: { b: SearchBreach }) {
  return (
    <li className="flex items-start gap-2 text-[12px]">
      <span className="flex-1">
        <ReportTitle
          report={{
            title: b.org_name,
            url: b.url,
            description: b.summary,
            sourceName: b.source_name,
            date: b.event_date,
            rawHash: b.raw_hash,
          }}
        />
        {b.summary ? (
          <span className="block truncate text-slate-500">{b.summary}</span>
        ) : null}
      </span>
      <span className="shrink-0 text-[10px] text-slate-400">
        {b.event_date_label ?? (b.event_date ? formatDate(b.event_date) : "")}
      </span>
    </li>
  );
}

function VulnRow({ v }: { v: SearchVuln }) {
  return (
    <li className="flex items-start gap-2 text-[12px]">
      <span className="mt-0.5 shrink-0">
        <VulnStatusBadge value={v.status} />
      </span>
      <span className="flex-1">
        <ReportTitle
          report={{
            title: v.cve_id,
            url: v.url,
            description: v.detail,
            sourceName: v.source_name,
            date: null,
            rawHash: v.raw_hash,
          }}
        />
        {v.target ? (
          <span className="block truncate text-slate-500">{v.target}</span>
        ) : null}
      </span>
    </li>
  );
}

/** The field reference, with runnable examples: clicking one fills the box. */
function QueryHelp({ onPick }: { onPick: (query: string) => void }) {
  const fields: [string, string][] = [
    ["label:", "Malware/ZimReaper, Target/Zimbra, AI/Claude"],
    ["adv: / actor:", "attributed adversary, either spelling"],
    ["ttp: / mitre:", "ATT&CK technique, e.g. T1059.001"],
    ["cve:", "CVE id, on the report or its indicators"],
    ["ip: dom: url: hash:", "indicators by type; defanged input is fine"],
    ["ioc:", "any indicator, whatever its type"],
    ["src:", "source feed name"],
    ["(bare words)", "title, summary and affected product"],
  ];
  const examples = [
    'label:Target/Zimbra AND adv:"FANCY BEAR"',
    "(ip:192.168 OR dom:evil) NOT label:AI/Claude",
    "dom:~\\.(ru|su)$",
    "zimbra -src:Reddit",
  ];
  return (
    <div className="mt-2 rounded-[10px] border border-[#e5e7eb] bg-slate-50 p-3 text-[12px]">
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
        Use <Op>:~</Op> instead of <Op>:</Op> to match a regular expression.
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
