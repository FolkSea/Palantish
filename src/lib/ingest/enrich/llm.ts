import "server-only";

import { computeHash } from "@/lib/ingest/dedup";
import type { Enricher, EnrichedItem, RawCandidate } from "@/lib/ingest/types";
import { AnalystAgent, type TriageResult } from "@/lib/agent/analyst";
import { RulesEnricher } from "./rules";
import type { GroupEntry } from "./rules";

/**
 * LLM-backed enricher: a thin adapter over the analyst agent's triage. Enabled
 * only when ANTHROPIC_API_KEY is set; otherwise the pipeline uses the rules
 * enricher. Falls back to the rules enricher on any per-item error so ingestion
 * never fails on the LLM. The `memoryBrief` is the agent's accumulated knowledge
 * of adversaries/trends, injected as context for every classification.
 */
export class LlmEnricher implements Enricher {
  readonly name = "llm";
  private agent: AnalystAgent;
  private fallback: RulesEnricher;

  constructor(apiKey: string, extraGroups: GroupEntry[] = [], memoryBrief = "") {
    this.agent = new AnalystAgent(apiKey, memoryBrief);
    this.fallback = new RulesEnricher(extraGroups);
  }

  private toItem(c: RawCandidate, parsed: TriageResult): EnrichedItem {
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
      labels: parsed.labels,
    };
  }

  /**
   * Classify one candidate: the enriched item when relevant, "drop" when the
   * agent judges it irrelevant, or "unavailable" when the call fails or cannot
   * be parsed (so callers can apply a keep-by-default policy).
   */
  async classify(
    c: RawCandidate,
  ): Promise<EnrichedItem | "drop" | "unavailable"> {
    if (!c.title || !c.url) return "drop";
    try {
      const parsed = await this.agent.triage(c);
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
}
