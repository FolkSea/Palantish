import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env";
import { computeAggregates, type Aggregates, type Db } from "./aggregates";

const DEFAULT_MODEL = "claude-sonnet-5";
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

const SYSTEM = `You are a cyber threat-intelligence analyst writing the executive summary panel for a nation-state cyber intelligence dashboard.
Write a concise, factual executive summary in plain ASCII text (no markdown headings, no emoji, no bullet characters).
First cover activity over the last 24 hours, then comment on notable trends observed over the last 7 days.
Use ONLY the data provided - do not invent actors, victims, or numbers. Keep it under 180 words, two short paragraphs.`;

async function aiSummary(
  a: Aggregates,
  apiKey: string,
): Promise<{ text: string; model: string }> {
  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_SUMMARY_MODEL || DEFAULT_MODEL;
  const message = await client.messages.create({
    model,
    max_tokens: 500,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Aggregated activity data (JSON):\n${JSON.stringify(a, null, 2)}\n\nWrite the executive summary.`,
      },
    ],
  });
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return { text, model };
}

export type GeneratedSummary = {
  summary: string;
  source: "ai" | "rules";
  model: string | null;
};

/**
 * Generate the executive summary (AI when ANTHROPIC_API_KEY is set, otherwise a
 * deterministic rules summary) and store it. Returns the stored summary.
 */
export async function generateAndStoreSummary(db: Db): Promise<GeneratedSummary> {
  const aggregates = await computeAggregates(db);

  let result: GeneratedSummary;
  const key = serverEnv.anthropicApiKey;
  if (key) {
    try {
      const { text, model } = await aiSummary(aggregates, key);
      result = { summary: text || rulesSummary(aggregates), source: text ? "ai" : "rules", model: text ? model : null };
    } catch {
      result = { summary: rulesSummary(aggregates), source: "rules", model: null };
    }
  } else {
    result = { summary: rulesSummary(aggregates), source: "rules", model: null };
  }

  await db.from("executive_summaries").insert({
    summary: result.summary,
    source: result.source,
    model: result.model,
    window_note: WINDOW_NOTE,
  });

  return result;
}
