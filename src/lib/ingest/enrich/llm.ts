import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { Nexus, Confidence } from "@/lib/badges";
import { computeHash } from "@/lib/ingest/dedup";
import type { Enricher, EnrichedItem, ItemType, RawCandidate } from "@/lib/ingest/types";
import { RulesEnricher } from "./rules";
import { serverEnv } from "@/lib/env";

// Classification of RSS/advisory items is a high-volume, low-complexity task,
// so this defaults to a small fast model. Override with ANTHROPIC_MODEL.
const DEFAULT_MODEL = "claude-haiku-4-5";

const NEXUS_VALUES: Nexus[] = ["china", "russia", "north_korea", "iran", "other"];
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

DROP (relevant=false) marketing, product announcements, vendor self-promotion, webinars, hiring, and opinion pieces.
Only include eCrime/ransomware when large-scale (many victims, major sector impact, or a well-known active campaign).

Return ONLY strict JSON matching this shape:
{
  "relevant": boolean,
  "nexus": "china" | "russia" | "north_korea" | "iran" | "other" | null,
  "itemType": "actor_activity" | "breach" | "vuln" | "report" | "breaking",
  "confidence": "confirmed" | "suspected" | "poc",
  "crowdstrikeAdversary": string | null
}
nexus is the attributed nation-state, or "other" for eCrime, or null if none.
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
  private fallback = new RulesEnricher();

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
    this.model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  }

  async enrich(c: RawCandidate): Promise<EnrichedItem | null> {
    if (!c.title || !c.url) return null;
    try {
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

      const parsed = this.parse(text);
      if (!parsed || !parsed.relevant) return null;

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
    } catch {
      // Never let the LLM break ingestion; degrade to rules.
      return this.fallback.enrich(c);
    }
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

/** Chooses the enricher based on configuration. */
export function selectEnricher(): Enricher {
  const key = serverEnv.anthropicApiKey;
  if (key) return new LlmEnricher(key);
  return new RulesEnricher();
}
