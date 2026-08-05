"use client";

// The dashboard's report list, in one place. "Other reporting" on the home page
// is the canonical presentation, and the browse, search and feed views all
// render through this so they cannot drift apart as copies.

import { Card, EmptyState } from "@/components/Card";
import { ItemActions } from "@/components/ItemActions";
import { AdversaryBadge, SourceBadge } from "@/components/Badges";
import { ReportTitle } from "@/components/ReportDetail";
import { LabelChips } from "@/components/LabelChips";
import {
  usePaginated,
  PaginationFooter,
  type Paged,
} from "@/components/Pagination";
import { formatDate } from "@/lib/format";
import { adversaryHref, sourceHref } from "@/lib/browse-links";

/** What the table needs from a report. Any of the fuller row types satisfies it. */
export type ReportTableRow = {
  id: string;
  title: string;
  url: string | null;
  description: string | null;
  source_name: string | null;
  published_at: string | null;
  country?: string | null;
  confidence?: string | null;
  // The attributed actor, as stored: the analyst's own attribution wins over
  // the feed's. Optional, and the badge renders nothing when there is none, so
  // an unattributed report simply shows no chip.
  adversary_label?: string | null;
  crowdstrike_adversary?: string | null;
  raw_hash: string;
  labels: string[];
};

export function ReportTable({
  title,
  items,
  empty = "No reports.",
  subtitle,
  pager,
}: {
  title: string;
  items: ReportTableRow[];
  /** Shown in place of the table when there is nothing to list. */
  empty?: string;
  /** Optional line under the title, e.g. a count. */
  subtitle?: string;
  /**
   * A pager over a list the server holds, for views whose rows do not all
   * arrive at once. Without it the table pages `items` itself, which is what
   * the browse, search and feed views want.
   */
  pager?: Paged<ReportTableRow> & { loading?: boolean };
}) {
  const local = usePaginated(items);
  const p = pager ?? local;
  return (
    <Card title={title} subtitle={subtitle}>
      {p.total === 0 ? (
        <EmptyState>{empty}</EmptyState>
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
                          country: r.country ?? null,
                          confidence: r.confidence ?? null,
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
                          name={r.adversary_label ?? r.crowdstrike_adversary ?? null}
                          href={adversaryHref(
                            r.adversary_label ?? r.crowdstrike_adversary ?? "",
                          )}
                        />
                        <SourceBadge
                          name={r.source_name}
                          href={sourceHref(r.source_name ?? "")}
                        />
                        <ItemActions rawHash={r.raw_hash} intelItemId={r.id} />
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
