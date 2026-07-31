import "server-only";

import { serverEnv } from "@/lib/env";
import { toAscii } from "@/lib/text";
import { AnalystAgent } from "@/lib/agent/analyst";
import { loadMemoryBrief } from "@/lib/agent/memory";
import { computeAggregates, type Aggregates, type Db } from "./aggregates";

const WINDOW_NOTE = "Last 24 hours of activity; trends over the last 7 days";

function topActors(byActor: Record<string, number>, n: number): string {
  return (
    Object.entries(byActor)
      .filter(([label]) => label !== "Unattributed")
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([label, count]) => `${label} (${count})`)
      .join(", ") || "none"
  );
}

/** Deterministic fallback summary built directly from the aggregates. */
export function rulesSummary(a: Aggregates): string {
  const d = a.last24h;
  const w = a.last7d;
  const notable = a.notable[0];

  const p1 =
    `In the last 24 hours: ${d.nationState} nation-state report(s), ` +
    `${d.ecrime} eCrime/breach incident(s), and ${d.vulns} vulnerability update(s). ` +
    (topActors(d.byActor, 3) !== "none"
      ? `Most active: ${topActors(d.byActor, 3)}. `
      : "No attributed nation-state reporting in the last 24 hours. ") +
    (notable ? `Notable item: "${notable.title}".` : "");

  const p2 =
    `Over the last 7 days: ${w.nationState} nation-state report(s) across ` +
    `${topActors(w.byActor, 4)}, ${w.ecrime} eCrime/breach incident(s), and ` +
    `${w.vulns} vulnerability update(s) ` +
    `(${a.vuln7d.confirmed} confirmed, ${a.vuln7d.poc} PoC, ${a.vuln7d.suspected} suspected).`;

  return `${p1}\n\n${p2}`.trim();
}

export type GeneratedSummary = {
  summary: string;
  source: "ai" | "rules";
  model: string | null;
};

/**
 * Generate the executive summary and store it. When ANTHROPIC_API_KEY is set the
 * analyst agent writes it (informed by its memory of adversaries/trends);
 * otherwise a deterministic rules summary is used. Returns the stored summary.
 */
export async function generateAndStoreSummary(db: Db): Promise<GeneratedSummary> {
  const aggregates = await computeAggregates(db);

  let result: GeneratedSummary;
  const key = serverEnv.anthropicApiKey;
  if (key) {
    try {
      const brief = await loadMemoryBrief(db);
      const agent = new AnalystAgent(key, brief);
      // The agent sees only id/kind/title for references (not urls/hashes).
      const references = aggregates.linkables
        .map((l) => `${l.id}: ${l.kind} - ${l.title}`)
        .join("\n");
      const counts = {
        last24h: aggregates.last24h,
        last7d: aggregates.last7d,
        vuln7d: aggregates.vuln7d,
        notable: aggregates.notable,
      };
      const { text, model } = await agent.summarize(references, counts);
      result = {
        summary: text || rulesSummary(aggregates),
        source: text ? "ai" : "rules",
        model: text ? model : null,
      };
    } catch {
      result = { summary: rulesSummary(aggregates), source: "rules", model: null };
    }
  } else {
    result = { summary: rulesSummary(aggregates), source: "rules", model: null };
  }

  // Force ASCII (drops any smart punctuation the model may emit).
  result.summary = toAscii(result.summary, true);

  // Keep only the reference items the prose actually cited (a "[id]" marker in
  // the text), so the panel can link each marker to the underlying item.
  const cited = aggregates.linkables.filter((l) =>
    result.summary.includes(`[${l.id}]`),
  );

  await db.from("executive_summaries").insert({
    summary: result.summary,
    source: result.source,
    model: result.model,
    window_note: WINDOW_NOTE,
    citations: JSON.parse(JSON.stringify(cited)),
  });

  return result;
}
