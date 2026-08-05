"use client";

import { Card, EmptyState } from "@/components/Card";
import {
  PriorityBadge,
  SourceBadge,
  VulnStatusBadge,
} from "@/components/Badges";
import { ReportTitle } from "@/components/ReportDetail";
import { LabelChips } from "@/components/LabelChips";
import { ReportTable } from "@/components/ReportTable";
import { useServerPaginated, PaginationFooter } from "@/components/Pagination";
import { formatDate } from "@/lib/format";
import { sourceHref } from "@/lib/browse-links";
import type { PrioritisedVuln } from "@/lib/vuln-priority";
import type { Page } from "@/lib/page";
import type { BreachRow, LabeledIntelRow } from "@/lib/data";
import {
  breachesPageAction,
  reportsPageAction,
  vulnerabilitiesPageAction,
} from "@/app/dashboard-actions";

// The rows arrive collapsed to one per CVE, prioritised and sorted on the
// server - so a page is ten CVEs, not ten reports about three of them.
export function VulnTable({ page }: { page: Page<PrioritisedVuln> }) {
  const p = useServerPaginated(page, vulnerabilitiesPageAction);
  return (
    <Card title="Trending exploits and vulnerabilities">
      {p.total === 0 ? (
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
                      <ReportTitle
                        report={{
                          title: v.cve_id,
                          url: v.url,
                          description: v.detail,
                          sourceName: v.source_name,
                          date: v.added_at,
                          // Editable in the modal; attributing moves it to research.
                          adversary: v.adversary,
                          confidence: "medium",
                          rawHash: v.raw_hash,
                        }}
                      />
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
                        <SourceBadge name={v.source_name} href={sourceHref(v.source_name ?? "")} />
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

export function BreachTable({ page }: { page: Page<BreachRow> }) {
  const p = useServerPaginated(page, breachesPageAction);
  return (
    <Card title="Reported breaches">
      {p.total === 0 ? (
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
                          title: b.title,
                          url: b.url,
                          description: b.description,
                          sourceName: b.source_name,
                          date: b.published_at,
                          // Editable in the modal; attributing moves it to research.
                          // Label first, as everywhere else: it is the corrected
                          // form, and the raw column may hold a bare family.
                          adversary: b.adversary_label ?? b.crowdstrike_adversary,
                          confidence: "medium",
                          rawHash: b.raw_hash,
                        }}
                      />
                      <LabelChips labels={b.labels} className="mt-1" />
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-slate-500">
                      {b.date_label ?? formatDate(b.published_at)}
                    </td>
                    <td className="py-2 text-slate-600">
                      {b.description}{" "}
                      <span className="ml-1 inline-block align-middle">
                        <SourceBadge
                          name={b.source_name}
                          href={sourceHref(b.source_name ?? "")}
                        />
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

export function ReportsList({ page }: { page: Page<LabeledIntelRow> }) {
  const p = useServerPaginated(page, reportsPageAction);
  return (
    <ReportTable
      title="Other reporting"
      items={page.rows}
      pager={p}
      empty="No reports loaded yet."
    />
  );
}
