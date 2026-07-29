"use client";

import { useState } from "react";
import { ReportModal, type ReportModalData } from "./ReportModal";
import type { SummaryCitation } from "@/lib/data";

/**
 * Render the executive summary prose, turning "[n]" citation markers into
 * clickable footnotes that open the referenced report in the modal.
 */
export function SummaryText({
  text,
  citations,
}: {
  text: string;
  citations: SummaryCitation[];
}) {
  const [open, setOpen] = useState<ReportModalData | null>(null);
  const byId = new Map(citations.map((c) => [c.id, c]));

  return (
    <>
      <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-slate-700">
        {text.split(/\n{2,}/).map((para, i) => (
          <p key={i}>{renderCitations(para, byId, setOpen)}</p>
        ))}
      </div>
      {open ? (
        <ReportModal report={open} onClose={() => setOpen(null)} />
      ) : null}
    </>
  );
}

function renderCitations(
  text: string,
  byId: Map<number, SummaryCitation>,
  open: (r: ReportModalData) => void,
) {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (m) {
      const c = byId.get(Number(m[1]));
      // Unknown citation ids (e.g. a model slip) are dropped rather than shown.
      if (!c) return null;
      return (
        <button
          key={i}
          type="button"
          title={c.title}
          onClick={() =>
            open({
              title: c.title,
              url: c.url,
              description: c.description,
              sourceName: c.sourceName,
              date: c.date,
              rawHash: c.rawHash,
            })
          }
          className="align-super text-[9px] font-semibold text-[#1d4ed8] hover:underline"
        >
          [{m[1]}]
        </button>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
