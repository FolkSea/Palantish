"use client";

import { useMemo } from "react";
import { Card, EmptyState } from "@/components/Card";
import { ItemActions } from "@/components/ItemActions";
import {
  PriorityBadge,
  SourceBadge,
  VulnStatusBadge,
} from "@/components/Badges";
import { ExtLink } from "@/components/ExtLink";
import { ReportTitle } from "@/components/ReportModal";
import { usePaginated, PaginationFooter } from "@/components/Pagination";
import { formatDate } from "@/lib/format";
import { prioritiseVulns } from "@/lib/vuln-priority";
import type { BreachRow, IntelItemRow, VulnerabilityRow } from "@/lib/data";

/* --- Trending exploits & vulnerabilities ---------------------------------- */
export function VulnTable({ rows }: { rows: VulnerabilityRow[] }) {
  // Collapse to one row per CVE, assign a priority from the statuses present,
  // sort by priority (then recency), and drop Low-priority CVEs.
  const prioritised = useMemo(() => prioritiseVulns(rows), [rows]);
  const p = usePaginated(prioritised);
  return (
    <Card title="Trending exploits and vulnerabilities">
      {prioritised.length === 0 ? (
        <EmptyState>
          No PoC or confirmed-exploited vulnerabilities right now.
        </EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-1.5 pr-3 font-medium">Priority</th>
                  <th className="py-1.5 pr-3 font-medium">CVE / ID</th>
                  <th className="py-1.5 pr-3 font-medium">Target</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {p.pageItems.map((v) => (
                  <tr
                    key={v.cve_id}
                    className="border-t border-slate-100 align-top"
                  >
                    <td className="py-2 pr-3">
                      <PriorityBadge value={v.priority} />
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <ExtLink href={v.url}>{v.cve_id}</ExtLink>
                    </td>
                    <td className="py-2 pr-3 text-slate-700">{v.target}</td>
                    <td className="py-2 pr-3">
                      <span className="flex flex-wrap gap-1">
                        {v.statuses.map((s) => (
                          <VulnStatusBadge key={s} value={s} />
                        ))}
                      </span>
                    </td>
                    <td className="py-2 text-slate-600">
                      {v.detail}{" "}
                      <span className="ml-1 inline-flex items-center gap-1 align-middle">
                        <SourceBadge name={v.source_name} />
                        {v.reportCount > 1 ? (
                          <span className="text-[10px] text-slate-400">
                            +{v.reportCount - 1} more
                          </span>
                        ) : null}
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
                  <th className="py-1.5 pr-3 font-medium">Title</th>
                  <th className="py-1.5 pr-3 font-medium">Date</th>
                  <th className="py-1.5 font-medium">What happened</th>
                </tr>
              </thead>
              <tbody>
                {p.pageItems.map((b) => (
                  <tr key={b.id} className="border-t border-slate-100 align-top">
                    <td className="py-2 pr-3">
                      <ReportTitle
                        report={{
                          title: b.org_name,
                          url: b.url,
                          description: b.summary,
                          sourceName: b.source_name,
                          date: b.event_date,
                        }}
                      />
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
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-1.5 pr-3 font-medium">Title</th>
                  <th className="py-1.5 pr-3 font-medium">Date</th>
                  <th className="py-1.5 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {p.pageItems.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 align-top">
                    <td className="py-2 pr-3">
                      <ReportTitle
                        report={{
                          title: r.title,
                          url: r.url,
                          description: r.description,
                          sourceName: r.source_name,
                          date: r.published_at,
                          confidence: r.confidence,
                          rawHash: r.raw_hash,
                        }}
                      />
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-slate-500">
                      {formatDate(r.published_at)}
                    </td>
                    <td className="py-2 text-slate-600">
                      {r.description}{" "}
                      <span className="ml-1 inline-flex items-center gap-2 align-middle">
                        {r.url ? (
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <SourceBadge name={r.source_name} />
                          </a>
                        ) : (
                          <SourceBadge name={r.source_name} />
                        )}
                        <ItemActions rawHash={r.raw_hash} />
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
