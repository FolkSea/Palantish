"use client";

import { ReportTable } from "@/components/ReportTable";
import type { LabeledIntelRow } from "@/lib/data";

/**
 * The /reports browse table: every report matching the chosen label, adversary
 * or source, newest first. Presented exactly like "Other reporting" on the
 * dashboard, through the shared table.
 */
export function BrowseList({ items }: { items: LabeledIntelRow[] }) {
  return (
    <ReportTable
      title="Matching reports"
      items={items}
      empty="No reports match this filter."
    />
  );
}
