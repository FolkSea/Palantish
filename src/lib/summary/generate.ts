import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env";
import { toAscii } from "@/lib/text";
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
Write a flowing, narrative briefing in plain ASCII prose (no markdown, no headings, no bullet characters, no emoji).
Paragraph 1: narrate the highlights of the last 24 hours - the most significant campaigns, intrusions, exploited vulnerabilities, and breaches, naming the threat actors, targets, and malware where the data provides them, and explaining why they matter.
Paragraph 2: describe the trends across the past 7 days - how activity is shifting, which actors or themes recur, and where attention is concentrating.
Write for a reader who wants the story, not a scoreboard: favour description over statistics, and cite specific numbers only sparingly, when a figure genuinely adds meaning. Do not open with, or string together, lists of counts.
The input includes a list of reference items, each with a numeric id. When you mention one of those specific events, campaigns, vulnerabilities, or breaches, append its id in square brackets immediately after the mention, e.g. "targeting Minnesota water utilities [3]". Cite only ids present in the reference list, place the marker right after the relevant phrase, and never invent or renumber a citation. Do not add a separate references or sources list.
Use ONLY the data provided - do not invent actors, victims, malware, or numbers. Keep it under 180 words in two short paragraphs.`;

async function aiSummary(
  a: Aggregates,
  apiKey: string,
): Promise<{ text: string; model: string }> {
  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_SUMMARY_MODEL || DEFAULT_MODEL;
  // The model sees only id/kind/title for references (not urls/hashes).
  const references = a.linkables
    .map((l) => `${l.id}: ${l.kind} - ${l.title}`)
    .join("\n");
  const counts = {
    last24h: a.last24h,
    last7d: a.last7d,
    vuln7d: a.vuln7d,
    notable: a.notable,
  };
  const message = await client.messages.create({
    model,
    max_tokens: 500,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content:
          `Reference items (id: kind - title):\n${references}\n\n` +
          `Aggregated counts (JSON):\n${JSON.stringify(counts, null, 2)}\n\n` +
          `Write the executive summary, adding [id] citation markers after specific mentions.`,
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
