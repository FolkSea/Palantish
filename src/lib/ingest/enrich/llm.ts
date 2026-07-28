import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { Nexus, Confidence } from "@/lib/badges";
import { computeHash } from "@/lib/ingest/dedup";
import type { Enricher, EnrichedItem, ItemType, RawCandidate } from "@/lib/ingest/types";
import { RulesEnricher } from "./rules";
import type { GroupEntry } from "./rules";

// Classification of RSS/advisory items is a high-volume, low-complexity task,
// so this defaults to a small fast model. Override with ANTHROPIC_MODEL.
const DEFAULT_MODEL = "claude-haiku-4-5";

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

const SYSTEM = `You are a cyber threat-intelligence triage classifier for a nation-state activity dashboard.
Given a security article/advisory, decide whether it is genuine threat intelligence worth ingesting, and classify it.

DROP (relevant=false) anything that is not genuine threat intelligence, including:
- marketing, product/feature announcements, vendor self-promotion, "use cases", customer stories;
- corporate/business news: funding, M&A, partnerships, alliances, awards, personnel/hiring, earnings, compliance/certification PR;
- conference/contest promotion (e.g. Black Hat, Pwn2Own, RSA), webinars and events;
- podcasts, newsletters, and "week in review" / roundup posts;
- opinion or thought-leadership pieces;
- consumer-lifestyle, general-privacy, or legal/policy stories with no attacker, malware, or vulnerability substance.
KEEP only reporting with concrete threat substance: threat-actor operations and campaigns, malware/tooling analysis, vulnerabilities and exploits, breaches/leaks/extortion, hacktivist operations (DDoS, website defacement, or data leaks by ideologically-motivated collectives such as Anonymous, KillNet, Anonymous Sudan, or NoName057(16)), and government or vendor security advisories.
Only include eCrime/ransomware when large-scale (many victims, major sector impact, or a well-known active campaign).

Return ONLY strict JSON matching this shape:
{
  "relevant": boolean,
  "nexus": "china" | "russia" | "north_korea" | "iran" | "rest_of_world" | "other" | null,
  "itemType": "actor_activity" | "breach" | "vuln" | "report" | "breaking",
  "confidence": "confirmed" | "suspected" | "poc",
  "crowdstrikeAdversary": string | null
}
nexus is the attributed nation-state (china/russia/north_korea/iran), "rest_of_world" for any OTHER nation-state actor (e.g. India, Turkey, Vietnam, Pakistan, South Korea), "other" for eCrime, or null if none.
crowdstrikeAdversary is the public CrowdStrike cryptonym (Panda/Bear/Chollima/Kitten/Spider naming) if one clearly applies, else null.`;

type LlmResult = {
  relevant: boolean;
  nexus: Nexus | null;
  itemType: ItemType;
  confidence: Confidence;
  crowdstrikeAdversary: string | null;
};

/**
 * LLM-backed enricher (Anthropic). Enabled only when ANTHROPIC_API_KEY is set;
 * otherwise the pipeline uses the rules enricher. Falls back to the rules
 * enricher on any per-item error so ingestion never fails on the LLM.
 */
export class LlmEnricher implements Enricher {
  readonly name = "llm";
  private client: Anthropic;
  private model: string;
  private fallback: RulesEnricher;

  constructor(apiKey: string, extraGroups: GroupEntry[] = []) {
    this.client = new Anthropic({ apiKey });
    this.model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
    this.fallback = new RulesEnricher(extraGroups);
  }

  private async request(c: RawCandidate): Promise<LlmResult | null> {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: 256,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Source: ${c.sourceName} (${c.sourceCategory ?? "unknown"})
Title: ${c.title}
Description: ${c.description ?? ""}`,
        },
      ],
    });
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return this.parse(text);
  }

  private toItem(c: RawCandidate, parsed: LlmResult): EnrichedItem {
    return {
      title: c.title,
      description: c.description,
      url: c.url,
      publishedAt: c.publishedAt ?? new Date(),
      nexus: parsed.nexus,
      itemType: parsed.itemType,
      confidence: parsed.confidence,
      crowdstrikeAdversary: parsed.crowdstrikeAdversary,
      sourceName: c.sourceName,
      rawHash: computeHash(c.title, c.url),
    };
  }

  /**
   * Classify one candidate: the enriched item when relevant, "drop" when the
   * model judges it irrelevant, or "unavailable" when the call fails or cannot
   * be parsed (so callers can apply a keep-by-default policy).
   */
  async classify(
    c: RawCandidate,
  ): Promise<EnrichedItem | "drop" | "unavailable"> {
    if (!c.title || !c.url) return "drop";
    try {
      const parsed = await this.request(c);
      if (!parsed) return "unavailable";
      return parsed.relevant ? this.toItem(c, parsed) : "drop";
    } catch {
      return "unavailable";
    }
  }

  async enrich(c: RawCandidate): Promise<EnrichedItem | null> {
    const r = await this.classify(c);
    if (r === "drop") return null;
    if (r === "unavailable") return this.fallback.enrich(c);
    return r;
  }

  private parse(text: string): LlmResult | null {
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
    };
  }
}
