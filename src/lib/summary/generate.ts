import "server-only";

import { serverEnv } from "@/lib/env";
import { toAscii } from "@/lib/text";
import { AnalystAgent } from "@/lib/agent/analyst";
import { loadMemoryBrief } from "@/lib/agent/memory";
import { computeAggregates, formatSummaryEvidence, type Db } from "./aggregates";

const WINDOW_NOTE = "Last 24 hours of reporting; trends over the last 7-30 days";

export type GeneratedSummary = {
  summary: string;
  source: "ai";
  model: string | null;
};

/**
 * Generate a narrative executive summary and store it. If narrative generation
 * is unavailable or fails, no replacement is stored, preserving the prior one.
 */
export async function generateAndStoreSummary(db: Db): Promise<GeneratedSummary> {
  const aggregates = await computeAggregates(db);

  let result: GeneratedSummary;
  const key = serverEnv.anthropicApiKey;
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is required for a narrative executive summary; previous narrative preserved.",
    );
  }

  try {
    const brief = await loadMemoryBrief(db);
    const agent = new AnalystAgent(key, brief);
    // Report evidence includes a bounded synopsis, attribution, date, and
    // source. URLs and hashes remain excluded from the model context.
    const references = formatSummaryEvidence(aggregates.linkables);
    const counts = {
      last24h: aggregates.last24h,
      last7d: aggregates.last7d,
      last30d: aggregates.last30d,
      vuln7d: aggregates.vuln7d,
      vuln30d: aggregates.vuln30d,
      notable: aggregates.notable,
    };
    const { text, model } = await agent.summarize(references, counts);
    if (!text) throw new Error("The analyst returned no summary text.");
    result = {
      summary: text,
      source: "ai",
      model,
    };
  } catch (error) {
    // A transient model failure must not overwrite the last good narrative
    // with a stats-only fallback. Callers log/surface this failure while the
    // dashboard continues showing the previous stored summary.
    throw new Error(
      `AI executive summary failed; previous narrative preserved: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // Force ASCII (drops any smart punctuation the model may emit).
  result.summary = toAscii(result.summary, true);

  // Keep only the reference items the prose actually cited (a "[id]" marker in
  // the text), so the panel can link each marker to the underlying item.
  const cited = aggregates.linkables
    .filter((l) => result.summary.includes(`[${l.id}]`))
    .map(({ id, title, url, description, sourceName, date, rawHash }) => ({
      id,
      title,
      url,
      description,
      sourceName,
      date,
      rawHash,
    }));

  await db.from("executive_summaries").insert({
    summary: result.summary,
    source: result.source,
    model: result.model,
    window_note: WINDOW_NOTE,
    citations: JSON.parse(JSON.stringify(cited)),
  });

  return result;
}
