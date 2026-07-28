"use client";

import { Card, EmptyState } from "@/components/Card";
import { SourceBadge, VulnStatusBadge } from "@/components/Badges";
import { ExtLink } from "@/components/ExtLink";
import { usePaginated, PaginationFooter } from "@/components/Pagination";
import { formatDate } from "@/lib/format";
import type { BreachRow, IntelItemRow, VulnerabilityRow } from "@/lib/data";

/* --- Trending exploits & vulnerabilities ---------------------------------- */
export function VulnTable({ rows }: { rows: VulnerabilityRow[] }) {
  const p = usePaginated(rows);
  return (
    <Card title="Trending exploits and vulnerabilities">
      {rows.length === 0 ? (
        <EmptyState>No vulnerabilities loaded yet.</EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-1.5 pr-3 font-medium">CVE / ID</th>
                  <th className="py-1.5 pr-3 font-medium">Target</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {p.pageItems.map((v) => (
                  <tr key={v.id} className="border-t border-slate-100 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <ExtLink href={v.url}>{v.cve_id}</ExtLink>
                    </td>
                    <td className="py-2 pr-3 text-slate-700">{v.target}</td>
                    <td className="py-2 pr-3">
                      <VulnStatusBadge value={v.status} />
                    </td>
                    <td className="py-2 text-slate-600">
                      {v.detail}{" "}
                      <span className="ml-1 inline-block align-middle">
                        <SourceBadge name={v.source_name} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationFooter {...p} />
        </>
      )}
    </Card>
  );
}

/* --- Reported breaches ----------------------------------------------------- */
export function BreachTable({ rows }: { rows: BreachRow[] }) {
  const p = usePaginated(rows);
  return (
    <Card title="Reported breaches">
      {rows.length === 0 ? (
        <EmptyState>No breaches loaded yet.</EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-1.5 pr-3 font-medium">Organisation</th>
                  <th className="py-1.5 pr-3 font-medium">Date</th>
                  <th className="py-1.5 font-medium">What happened</th>
                </tr>
              </thead>
              <tbody>
                {p.pageItems.map((b) => (
                  <tr key={b.id} className="border-t border-slate-100 align-top">
                    <td className="py-2 pr-3 font-medium text-slate-900">
                      {b.org_name}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-slate-500">
                      {b.event_date_label ?? formatDate(b.event_date)}
                    </td>
                    <td className="py-2 text-slate-600">
                      {b.summary}{" "}
                      <span className="ml-1 inline-block align-middle">
                        {b.url ? (
                          <a
                            href={b.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <SourceBadge name={b.source_name} />
                          </a>
                        ) : (
                          <SourceBadge name={b.source_name} />
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationFooter {...p} />
        </>
      )}
    </Card>
  );
}

/* --- Newly released reporting --------------------------------------------- */
export function ReportsList({ items }: { items: IntelItemRow[] }) {
  const p = usePaginated(items);
  return (
    <Card title="Newly released reporting">
      {items.length === 0 ? (
        <EmptyState>No reports loaded yet.</EmptyState>
      ) : (
        <>
          <ul className="space-y-2">
            {p.pageItems.map((r) => (
              <li key={r.id} className="flex items-start gap-2 text-[12px]">
                <span className="mt-0.5">
                  <SourceBadge name={r.source_name} />
                </span>
                <span className="flex-1">
                  <ExtLink href={r.url}>{r.title}</ExtLink>
                  {r.description ? (
                    <span className="block text-slate-500">{r.description}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[10px] text-slate-400">
                  {formatDate(r.published_at)}
                </span>
              </li>
            ))}
          </ul>
          <PaginationFooter {...p} />
        </>
      )}
    </Card>
  );
}
