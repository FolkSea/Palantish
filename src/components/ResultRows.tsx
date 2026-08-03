"use client";

// The result rows shared by the dashboard search and the personal feed, so the
// two always look the same rather than drifting as copies.

import { ReportTitle } from "@/components/ReportDetail";
import { SourceBadge, VulnStatusBadge } from "@/components/Badges";
import { sourceHref } from "@/lib/browse-links";
import { formatDate } from "@/lib/format";
import type { SearchReport, SearchBreach, SearchVuln } from "@/app/actions";

export function Section({
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

export function ReportRow({ r }: { r: SearchReport }) {
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

export function BreachRow({ b }: { b: SearchBreach }) {
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

export function VulnRow({ v }: { v: SearchVuln }) {
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
