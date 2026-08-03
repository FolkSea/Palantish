"use client";

import Link from "next/link";
import { itemHref } from "@/lib/browse-links";
import type { SummaryCitation } from "@/lib/data";
import {
  DEFAULT_READING_PREFS,
  readingStyle,
  type ReadingPrefs,
} from "@/lib/reading-prefs";

/**
 * Render the executive summary prose, turning "[n]" citation markers into
 * links to the referenced report's own page.
 */
export function SummaryText({
  text,
  citations,
  reading = DEFAULT_READING_PREFS,
}: {
  text: string;
  citations: SummaryCitation[];
  /** The reader's chosen font and size, shared with the report pane. */
  reading?: ReadingPrefs;
}) {
  const byId = new Map(citations.map((c) => [c.id, c]));

  return (
    <div
      className="mt-2 space-y-2 leading-relaxed text-slate-700"
      style={readingStyle(reading)}
    >
      {text.split(/\n{2,}/).map((para, i) => (
        <p key={i}>{renderCitations(para, byId)}</p>
      ))}
    </div>
  );
}

function renderCitations(text: string, byId: Map<number, SummaryCitation>) {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (m) {
      const c = byId.get(Number(m[1]));
      // Unknown citation ids (e.g. a model slip) are dropped rather than shown.
      if (!c) return null;
      return (
        <Link
          key={i}
          href={itemHref(c.rawHash)}
          title={c.title}
          className="align-super font-semibold text-[#1d4ed8] hover:underline"
          style={{ fontSize: "0.7em" }}
        >
          [{m[1]}]
        </Link>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
