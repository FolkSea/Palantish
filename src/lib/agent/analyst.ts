import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { Nexus, Confidence } from "@/lib/badges";
import type { ItemType, RawCandidate } from "@/lib/ingest/types";
import { parseReflection, type MemoryUpdate } from "./memory";
import { parseLabels } from "./labels";

// Per-item triage is high-volume/low-complexity, so it defaults to a small fast
// model; the summary and the reflection are lower-volume/higher-judgement, so
// they default to a stronger model. All three are overridable from the env.
const TRIAGE_MODEL_DEFAULT = "claude-haiku-4-5";
const SUMMARY_MODEL_DEFAULT = "claude-sonnet-5";
const REFLECT_MODEL_DEFAULT = "claude-sonnet-5";
// Per-call timeout so one slow request never stalls a worker (see LlmEnricher).
const REQUEST_TIMEOUT_MS = Number(process.env.INGEST_LLM_TIMEOUT_MS) || 20000;

const NEXUS_VALUES: Nexus[] = [
  "china",
  "russia",
  "north_korea",
  "iran",
  "rest_of_world",
  "other",
];
const ITEM_TYPES: ItemType[] = [
  "actor_activity",
  "breach",
  "vuln",
  "report",
  "breaking",
];
const CONFIDENCE_VALUES: Confidence[] = ["confirmed", "suspected", "poc"];

/** The agent's identity, shared across triage, summarising, and reflection. */
export const ANALYST_PERSONA = `You are a cybersecurity analyst, whose task is to triage and classify industry open-source reports for a nation-state and eCrime cyber-intelligence dashboard, and to write its executive summaries.
You reason only from the open-source reporting in front of you: stay evidence-based, prefer precise attribution over speculation, and never invent threat actors, victims, malware, or numbers.
You maintain a running memory of adversaries and cross-report trends. When a memory brief is provided, use it to inform attribution and context - but the report in front of you always overrides stale memory.`;

// How the dashboard files an item, so the agent classifies to match the sections
// (the ingest pipeline maps itemType + attribution onto the kind).
const TRIAGE_INSTRUCTIONS = `Decide whether an item is genuine threat intelligence worth ingesting, then classify it.

DROP (relevant=false) anything that is not genuine threat intelligence: marketing, product/feature announcements, vendor self-promotion, "use cases" and customer stories; corporate/business news (funding, M&A, partnerships, awards, hiring, earnings, compliance PR); conference/contest/webinar promotion; podcasts, newsletters, and "week in review" roundups; opinion/thought-leadership; and consumer-lifestyle or legal/policy stories with no attacker, malware, or vulnerability substance.

KEEP genuine reporting and classify itemType so it lands in the right section:
- "actor_activity": activity attributed to a named threat actor or crew (nation-state, eCrime, or hacktivist) - a campaign, intrusion, tooling/malware analysis, or a claimed incident. This becomes the actor's card, so use it whenever a specific actor is named, incident OR analysis.
- "vuln": a vulnerability or exploit - a CVE, a security advisory/bulletin, or a proof-of-concept. This becomes an Exploits entry.
- "breach": a breach/leak/extortion disclosure that is NOT attributed to a named actor (an unattributed victim disclosure).
- "report": general threat-intelligence reporting with no specific named actor, vulnerability, or breach event.
- "breaking": high-signal breaking news that does not fit the above.

Only keep eCrime/ransomware when it names a crew or is large-scale (many victims or major sector impact); drop a bare crew mention with no substance.

Also assign taxonomy labels for the item, drawn ONLY from what the report actually states:
- malware: named malware families, tools or RATs (e.g. "Flying Eagle", "ValleyRAT", "Cobalt Strike").
- adversary: named threat actors or crews (e.g. "Fancy Bear", "Lazarus Group", "Scattered Spider").
- target: the targeted product, system, sector or organisation (e.g. "Zimbra", "SharePoint", "water utilities").
- ai: an AI model or assistant named as used in the attack/tooling (e.g. "Claude", "ChatGPT"); usually empty.
Give each as a short bare name (no prefix); omit a category when nothing applies. Do not invent labels. When a name in the memory brief's "Known labels" list matches, reuse that exact name so labelling stays consistent.

Return ONLY strict JSON of this shape:
{
  "relevant": boolean,
  "nexus": "china" | "russia" | "north_korea" | "iran" | "rest_of_world" | "other" | null,
  "itemType": "actor_activity" | "breach" | "vuln" | "report" | "breaking",
  "confidence": "confirmed" | "suspected" | "poc",
  "crowdstrikeAdversary": string | null,
  "labels": { "malware": string[], "adversary": string[], "target": string[], "ai": string[] }
}
nexus is the attributed nation-state (china/russia/north_korea/iran), "rest_of_world" for any other nation-state (e.g. India, Turkey, Vietnam, Pakistan, South Korea), "other" for eCrime or hacktivism, or null if none.
crowdstrikeAdversary is the public CrowdStrike cryptonym (Panda/Bear/Chollima/Kitten/Spider/Jackal naming) when one clearly applies, else null.`;

const SUMMARY_INSTRUCTIONS = `Write the executive summary panel for the dashboard.
Write a flowing, narrative briefing in plain ASCII prose (no markdown, no headings, no bullet characters, no emoji).
Paragraph 1: narrate the highlights of the last 24 hours - the most significant campaigns, intrusions, exploited vulnerabilities, and breaches, naming the threat actors, targets, and malware where the data provides them, and explaining why they matter.
Paragraph 2: describe the trends across the past 7 days - how activity is shifting, which actors or themes recur, and where attention is concentrating; draw on your tracked-trends memory where it is corroborated by the data.
Write for a reader who wants the story, not a scoreboard: favour description over statistics, and cite specific numbers only sparingly. Do not open with, or string together, lists of counts.
The input includes reference items with numeric ids. When you mention one of those specific events, append its id in square brackets immediately after the mention, e.g. "targeting Minnesota water utilities [3]". Cite only ids present in the reference list, place the marker right after the relevant phrase, and never invent or renumber a citation. Do not add a separate references or sources list.
Use ONLY the data provided - do not invent actors, victims, malware, or numbers. Keep it under 180 words in two short paragraphs.`;

const REFLECT_INSTRUCTIONS = `Update your long-term memory from this run's kept reports.
Produce concise, durable intelligence notes - not a summary of the run.
For adversaries: for each named threat actor that appears with real substance, write or refresh a 1-2 sentence note capturing its nexus/motivation, known aliases, characteristic tradecraft or tooling, typical targeting, and its most recent observed activity. Use the actor's common name as the subject. Skip actors mentioned only in passing.
For trends: identify up to 5 cross-report themes worth tracking (e.g. a targeted sector, a shared technique, a supply-chain pattern, a surge in a malware family). Give each a short slug-like subject and a 1-2 sentence description.
Prefer updating subjects already in memory over creating near-duplicates. Keep every note ASCII, specific, and evidence-based.
Return ONLY strict JSON of this shape:
{
  "adversaries": [ { "subject": string, "content": string } ],
  "trends": [ { "subject": string, "content": string } ]
}`;

/** Parsed triage classification for one candidate. */
export type TriageResult = {
  relevant: boolean;
  nexus: Nexus | null;
  itemType: ItemType;
  confidence: Confidence;
  crowdstrikeAdversary: string | null;
  // Canonical `Prefix/Value` taxonomy labels (AI/Malware/Adversary/Target).
  labels: string[];
};

/** A compact observation about one kept report, fed into reflection. */
export type ReflectionInput = {
  title: string;
  kind: string;
  adversary: string | null;
};

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * The cybersecurity-analyst agent: one persona that triages/classifies reports,
 * writes the executive summary, and reflects on a run to maintain its memory. A
 * `memoryBrief` (from lib/agent/memory) is injected as context so all three
 * tasks share the agent's accumulated knowledge of adversaries and trends.
 */
export class AnalystAgent {
  private client: Anthropic;
  private memoryBrief: string;

  constructor(apiKey: string, memoryBrief = "") {
    this.client = new Anthropic({
      apiKey,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    });
    this.memoryBrief = memoryBrief;
  }

  private system(instructions: string, withMemory: boolean): string {
    const parts = [ANALYST_PERSONA, instructions];
    if (withMemory && this.memoryBrief)
      parts.push(`Memory brief (your accumulated knowledge):\n${this.memoryBrief}`);
    return parts.join("\n\n");
  }

  /** Classify one candidate; null when the call fails or cannot be parsed. */
  async triage(c: RawCandidate): Promise<TriageResult | null> {
    const model = process.env.ANTHROPIC_MODEL || TRIAGE_MODEL_DEFAULT;
    const message = await this.client.messages.create({
      model,
      max_tokens: 400,
      system: this.system(TRIAGE_INSTRUCTIONS, true),
      messages: [
        {
          role: "user",
          content: `Source: ${c.sourceName} (${c.sourceCategory ?? "unknown"})
Title: ${c.title}
Description: ${c.description ?? ""}`,
        },
      ],
    });
    return this.parseTriage(textOf(message));
  }

  /** Write the executive summary from the aggregates; empty on failure. */
  async summarize(
    references: string,
    counts: unknown,
  ): Promise<{ text: string; model: string }> {
    const model = process.env.ANTHROPIC_SUMMARY_MODEL || SUMMARY_MODEL_DEFAULT;
    const message = await this.client.messages.create({
      model,
      max_tokens: 500,
      system: this.system(SUMMARY_INSTRUCTIONS, true),
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
    return { text: textOf(message).trim(), model };
  }

  /**
   * Reflect on the run's kept reports and return memory updates. `existing`
   * lists the subjects already in memory so the agent refreshes them instead of
   * creating duplicates. Returns [] on failure (memory is simply not updated).
   */
  async reflect(
    reports: ReflectionInput[],
    existing: string[],
  ): Promise<MemoryUpdate[]> {
    if (reports.length === 0) return [];
    const model = process.env.ANTHROPIC_SUMMARY_MODEL || REFLECT_MODEL_DEFAULT;
    const lines = reports
      .map(
        (r) =>
          `- [${r.kind}]${r.adversary ? ` (${r.adversary})` : ""} ${r.title}`,
      )
      .join("\n");
    const known = existing.length ? existing.join(", ") : "none yet";
    try {
      const message = await this.client.messages.create({
        model,
        max_tokens: 1500,
        system: this.system(REFLECT_INSTRUCTIONS, true),
        messages: [
          {
            role: "user",
            content: `Subjects already in memory: ${known}\n\nThis run's kept reports:\n${lines}\n\nReturn the memory updates as JSON.`,
          },
        ],
      });
      return parseReflection(textOf(message));
    } catch {
      return [];
    }
  }

  private parseTriage(text: string): TriageResult | null {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(match[0]);
    } catch {
      return null;
    }
    if (typeof raw !== "object" || raw === null) return null;
    const o = raw as Record<string, unknown>;
    const nexus =
      typeof o.nexus === "string" && NEXUS_VALUES.includes(o.nexus as Nexus)
        ? (o.nexus as Nexus)
        : null;
    const itemType = ITEM_TYPES.includes(o.itemType as ItemType)
      ? (o.itemType as ItemType)
      : "report";
    const confidence = CONFIDENCE_VALUES.includes(o.confidence as Confidence)
      ? (o.confidence as Confidence)
      : "suspected";
    return {
      relevant: Boolean(o.relevant),
      nexus,
      itemType,
      confidence,
      crowdstrikeAdversary:
        typeof o.crowdstrikeAdversary === "string" && o.crowdstrikeAdversary
          ? o.crowdstrikeAdversary
          : null,
      labels: parseLabels(o.labels),
    };
  }
}
