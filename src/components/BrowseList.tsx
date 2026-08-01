"use client";

import { Card, EmptyState } from "@/components/Card";
import { ItemActions } from "@/components/ItemActions";
import { AdversaryBadge, SourceBadge } from "@/components/Badges";
import { ReportTitle } from "@/components/ReportModal";
import { LabelChips } from "@/components/LabelChips";
import { usePaginated, PaginationFooter } from "@/components/Pagination";
import { formatDate } from "@/lib/format";
import { adversaryHref, sourceHref } from "@/lib/browse-links";
import type { LabeledIntelRow } from "@/lib/data";

/**
 * The /reports browse table: every report matching the chosen label, adversary
 * or source, newest first. Rows behave like the dashboard's - the title opens
 * the report modal, and the badges are themselves links into other filters.
 */
export function BrowseList({ items }: { items: LabeledIntelRow[] }) {
  const p = usePaginated(items, 20);
  return (
    <Card title="Matching reports">
      {items.length === 0 ? (
        <EmptyState>No reports match this filter.</EmptyState>
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
                          country: r.country,
                          confidence: r.confidence,
                          rawHash: r.raw_hash,
                        }}
                      />
                      <LabelChips labels={r.labels} className="mt-1" />
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-slate-500">
                      {formatDate(r.published_at)}
                    </td>
                    <td className="py-2 text-slate-600">
                      {r.description}{" "}
                      <span className="ml-1 inline-flex items-center gap-2 align-middle">
                        <AdversaryBadge
                          name={r.adversary_label ?? r.crowdstrike_adversary}
                          href={adversaryHref(
                            r.adversary_label ?? r.crowdstrike_adversary ?? "",
                          )}
                        />
                        <SourceBadge
                          name={r.source_name}
                          href={sourceHref(r.source_name ?? "")}
                        />
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
