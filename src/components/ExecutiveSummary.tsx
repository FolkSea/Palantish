import CompiledTime from "./CompiledTime";
import { SummaryText } from "./SummaryText";
import type { ExecutiveSummary as Summary } from "@/lib/data";
import {
  DEFAULT_READING_PREFS,
  type ReadingPrefs,
} from "@/lib/reading-prefs";

export function ExecutiveSummaryPanel({
  summary,
  reading = DEFAULT_READING_PREFS,
}: {
  summary: Summary | null;
  /** The reader's chosen font and size, shared with the report pane. */
  reading?: ReadingPrefs;
}) {
  return (
    <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-slate-900">
          Executive summary
        </h2>
        {summary ? (
          <span className="text-[10px] uppercase tracking-wide text-slate-400">
            {summary.source === "ai"
              ? `AI generated${summary.model ? ` (${summary.model})` : ""}`
              : "Auto-generated"}
            {" - "}
            <CompiledTime iso={summary.generatedAt} label="Generated" />
          </span>
        ) : null}
      </div>

      {summary ? (
        <SummaryText
          text={summary.summary}
          citations={summary.citations}
          reading={reading}
        />
      ) : (
        <p className="mt-2 text-[12px] text-slate-400">
          No summary yet. It is generated on each ingest run (set
          ANTHROPIC_API_KEY to enable AI-written summaries).
        </p>
      )}
    </section>
  );
}
