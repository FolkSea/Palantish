import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { RawCandidate } from "@/lib/ingest/types";
import { parseReflection, type MemoryUpdate } from "./memory";
import {
  REVIEW_SYSTEM_PROMPT,
  buildReviewPrompt,
  parseReviewResponse,
  type ReviewCandidate,
  type ReviewVerdict,
} from "@/lib/ioc-review/candidates";
import {
  WEB_TRIAGE_INSTRUCTIONS,
  allowedDomainsFor,
  buildTriageUserMessage,
  parseFetchOutcome,
  parseWebTriage,
  textOfBlocks,
  webFetchTool,
  type FetchStatus,
  type WebTriageOutcome,
} from "./web-triage";

const SUMMARY_MODEL_DEFAULT = "claude-sonnet-5";
const REFLECT_MODEL_DEFAULT = "claude-sonnet-5";
// Judging whether a value looks like attacker infrastructure is recognition, not
// analysis, and it runs over a list rather than over prose - so it defaults to
// the cheap model. Overridable via ANTHROPIC_IOC_REVIEW_MODEL.
const IOC_REVIEW_MODEL_DEFAULT = "claude-haiku-4-5-20251001";
// Web-fetch triage reads and analyses the full article, so it defaults to a
// stronger model; overridable via ANTHROPIC_MODEL. The content cap bounds tokens
// spent on an unexpectedly large page or PDF.
const WEB_TRIAGE_MODEL_DEFAULT = "claude-sonnet-5";
const WEB_FETCH_MAX_CONTENT_TOKENS =
  Number(process.env.WEB_FETCH_MAX_CONTENT_TOKENS) || 8000;
// Per-call timeout so one slow request never stalls a worker (see LlmEnricher).
const REQUEST_TIMEOUT_MS = Number(process.env.INGEST_LLM_TIMEOUT_MS) || 20000;
// The summary and the end-of-run reflection are single, large calls over the
// whole run rather than one small call per item, so they need far more headroom
// than the per-item budget above: reflecting on 80 reports took well over the
// 20s per-item timeout, which silently produced no memory at all. Kept well
// under the remaining function time so finalisation still fits in maxDuration.
const LONG_CALL_TIMEOUT_MS =
  Number(process.env.INGEST_LLM_LONG_TIMEOUT_MS) || 60000;

export const ANALYST_PERSONA = `You are a cybersecurity analyst, whose task is to triage and classify industry open-source reports for a nation-state and eCrime cyber-intelligence dashboard, and to write its executive summaries.
You reason only from the open-source reporting in front of you: stay evidence-based, prefer precise attribution over speculation, and never invent threat actors, victims, malware, or numbers.
You maintain a running memory of adversaries and cross-report trends. When a memory brief is provided, use it to inform attribution and context - but the report in front of you always overrides stale memory.`;

const SUMMARY_INSTRUCTIONS = `Write the executive summary panel for the dashboard.
Write a flowing, narrative briefing in plain ASCII prose (no markdown, no headings, no bullet characters, no emoji).
You are summarising what has been REPORTED, not activity you have witnessed. Several reports routinely describe a single incident - a vendor write-up, the news coverage of it, and a follow-up - so treat the evidence as coverage of events rather than as the events themselves.
Write "Reporting continued on COZY BEAR intrusions at European hotels" rather than "COZY BEAR continued its attacks on European hotels". Attribute activity directly only where the reports clearly describe separate incidents - different victims, different dates, distinct intrusions - and then say what makes them separate.
Publication is not observation: an article published this morning may describe an intrusion from last year, and a run of reports on one subject is a rise in coverage, which is not by itself a rise in activity. Never turn a count of reports into a count of attacks.
Paragraph 1: narrate the highlights of the last 24 hours - the most significant campaigns, intrusions, exploited vulnerabilities, and breaches reported, naming the threat actors, targets, and malware where the data provides them, and explaining why they matter.
Paragraph 2: explain the trends in the reporting across the last 7-30 days. Compare the most recent week with the earlier portion of the 30-day evidence: identify recurring actors, malware, targets, sectors, vulnerability themes, or tradecraft; say what is being reported persistently, what is newly reported, and what has dropped out of the reporting. Draw on tracked-trends memory only where the supplied reports corroborate it.
Write for a reader who wants the story, not a scoreboard: favour description over statistics, and cite specific numbers only sparingly. Do not open with, or string together, lists of counts.
The evidence is divided into last24h, days2to7, and days8to30 windows and includes report synopses. Base the narrative on those synopses, not on titles or counts alone. The input includes reference items with numeric ids. When you mention one of those specific events, append its id in square brackets immediately after the mention, e.g. "targeting Minnesota water utilities [3]". Cite only ids present in the reference list, place the marker right after the relevant phrase, and never invent or renumber a citation. Do not add a separate references or sources list.
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

  /**
   * Triage a candidate by having Claude fetch the report URL with the server
   * web_fetch tool and analyse the article, returning validated JSON. The fetch
   * outcome (full / feed_only / failed) is decided from the actual tool-result
   * blocks - never the model's own claim. Bounded by max_content_tokens and the
   * host allow-list; resumes a server-tool pause_turn. Returns a failed outcome
   * (parsed=null) on any error so callers can fall back to rules/RSS.
   */
  async triageWithFetch(
    c: RawCandidate,
    /** Overrides the default model - see enrich/model-tier. */
    modelOverride?: string,
  ): Promise<WebTriageOutcome> {
    const model =
      modelOverride || process.env.ANTHROPIC_MODEL || WEB_TRIAGE_MODEL_DEFAULT;
    const tool = webFetchTool(model, {
      allowedDomains: allowedDomainsFor(c.url),
      maxContentTokens: WEB_FETCH_MAX_CONTENT_TOKENS,
    });
    const params = {
      // Generous budget: the enhanced tool runs several fetch/filter rounds with
      // thinking before the final JSON, and a truncated turn yields no text block
      // at all (which would look like an unparseable response).
      model,
      max_tokens: 8000,
      system: this.system(WEB_TRIAGE_INSTRUCTIONS, true),
      tools: [tool],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const create = (this.client as any).messages.create.bind(this.client.messages);
    // Web fetch + analysis is slower than plain triage; give it a longer budget.
    const options = { timeout: REQUEST_TIMEOUT_MS * 4 };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let content: any[] = [];
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const messages: any[] = [
        { role: "user", content: buildTriageUserMessage(c) },
      ];
      let msg = await create({ ...params, messages }, options);
      // Resume the server-tool sampling loop if it paused (bounded).
      let guard = 0;
      while (msg.stop_reason === "pause_turn" && guard++ < 4) {
        messages.push({ role: "assistant", content: msg.content });
        msg = await create({ ...params, messages }, options);
      }
      content = msg.content ?? [];
    } catch {
      return { parsed: null, fetchStatus: "failed", fetchedText: null, fetchedUrl: null };
    }

    const outcome = parseFetchOutcome(content);
    const parsed = parseWebTriage(textOfBlocks(content));
    if (!parsed)
      return {
        parsed: null,
        fetchStatus: "failed",
        fetchedText: outcome.text,
        fetchedUrl: outcome.fetchedUrl,
      };
    // fetchStatus reflects the real web_fetch result, not the model's claim.
    const fetchStatus: FetchStatus = outcome.succeeded ? "full" : "feed_only";
    return {
      parsed: { ...parsed, fetchStatus },
      fetchStatus,
      fetchedText: outcome.succeeded ? outcome.text : null,
      fetchedUrl: outcome.fetchedUrl,
    };
  }

  /**
   * Review indicators that join reports together and report the ones that are
   * not really indicators.
   *
   * No memory brief: this is a judgement about what a value IS, and the running
   * narrative of who is attacking whom would only bias it toward seeing
   * infrastructure everywhere.
   */
  async reviewIndicators(
    candidates: ReviewCandidate[],
  ): Promise<{ verdicts: ReviewVerdict[]; model: string }> {
    const model =
      process.env.ANTHROPIC_IOC_REVIEW_MODEL || IOC_REVIEW_MODEL_DEFAULT;
    if (candidates.length === 0) return { verdicts: [], model };
    const message = await this.client.messages.create(
      {
        model,
        // One short JSON object per problem, over a list of at most 80.
        max_tokens: 4000,
        // No output_config here: the cheap model rejects the effort parameter
        // outright ("This model does not support the effort parameter"), and it
        // does not think adaptively, so there is nothing to constrain.
        system: REVIEW_SYSTEM_PROMPT,
        messages: [
          { role: "user", content: buildReviewPrompt(candidates) },
        ],
      },
      { timeout: LONG_CALL_TIMEOUT_MS },
    );
    return {
      verdicts: parseReviewResponse(textOf(message), candidates),
      model,
    };
  }

  async summarize(
    references: string,
    counts: unknown,
  ): Promise<{ text: string; model: string }> {
    const model = process.env.ANTHROPIC_SUMMARY_MODEL || SUMMARY_MODEL_DEFAULT;
    const message = await this.client.messages.create(
      {
        model,
        // This covers reasoning and final prose; too small a budget can yield no
        // text, while low effort keeps generation within its timeout.
        max_tokens: 4000,
        output_config: { effort: "low" },
        system: this.system(SUMMARY_INSTRUCTIONS, true),
        messages: [
          {
            role: "user",
            content:
              `Report evidence:\n${references}\n\n` +
              `Window context (supporting data, not the structure of the prose):\n${JSON.stringify(counts, null, 2)}\n\n` +
              `Write the executive summary, adding [id] citation markers after specific mentions.`,
          },
        ],
      },
      { timeout: LONG_CALL_TIMEOUT_MS },
    );
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
    // Deliberately NOT wrapped in a catch: a swallowed failure here writes no
    // memory and reports no error, which is indistinguishable from "the run had
    // nothing to remember". The caller logs the failure against the run.
    const message = await this.client.messages.create(
      {
        model,
        // Must cover thinking AND the JSON: the reflect model thinks adaptively
        // by default, and max_tokens caps both together. At 1500 a reflection
        // over 80 reports spent the whole budget thinking and returned no text
        // at all, which parsed to "no memory updates" and silently wrote
        // nothing. Sized so the JSON always has room after the reasoning.
        max_tokens: 8000,
        // Condensing reports into notes is extraction, not deep reasoning, and
        // unconstrained thinking here is slow enough to hit the call timeout.
        output_config: { effort: "low" },
        system: this.system(REFLECT_INSTRUCTIONS, true),
        messages: [
          {
            role: "user",
            content: `Subjects already in memory: ${known}\n\nThis run's kept reports:\n${lines}\n\nReturn the memory updates as JSON.`,
          },
        ],
      },
      { timeout: LONG_CALL_TIMEOUT_MS },
    );
    return parseReflection(textOf(message));
  }

}
