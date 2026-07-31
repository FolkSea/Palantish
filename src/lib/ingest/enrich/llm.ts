import "server-only";

import { computeHash } from "@/lib/ingest/dedup";
import type { Enricher, EnrichedItem, RawCandidate } from "@/lib/ingest/types";
import { AnalystAgent } from "@/lib/agent/analyst";
import type { WebTriageOutcome } from "@/lib/agent/web-triage";
import { RulesEnricher } from "./rules";
import type { GroupEntry } from "./rules";
import type { LlmVerdict } from "./hybrid";

/**
 * LLM-backed enricher: triages via the analyst agent's web-fetch triage, which
 * has Claude fetch and analyse the report URL (server web_fetch tool) and return
 * validated JSON - classification, labels, a summary, ATT&CK techniques, and the
 * IOCs found in the fetched article (reconciled and persisted downstream by the
 * pipeline). Enabled only when ANTHROPIC_API_KEY is set; falls back to the rules
 * enricher on any per-item error so ingestion never fails on the LLM. The
 * `memoryBrief` is the agent's accumulated knowledge, injected as context.
 */
export class LlmEnricher implements Enricher {
  readonly name = "llm";
  private agent: AnalystAgent;
  private fallback: RulesEnricher;

  constructor(apiKey: string, extraGroups: GroupEntry[] = [], memoryBrief = "") {
    this.agent = new AnalystAgent(apiKey, memoryBrief);
    this.fallback = new RulesEnricher(extraGroups);
  }

  private toItem(c: RawCandidate, out: WebTriageOutcome): EnrichedItem {
    const p = out.parsed!;
    return {
      title: c.title,
      description: c.description,
      url: c.url,
      publishedAt: c.publishedAt ?? new Date(),
      nexus: p.nexus,
      itemType: p.itemType,
      confidence: p.confidence,
      crowdstrikeAdversary: p.crowdstrikeAdversary,
      sourceName: c.sourceName,
      rawHash: computeHash(c.title, c.url),
      labels: p.labels,
      dashboardKind: p.dashboardKind,
      summary: p.summary || null,
      mitreTechniques: p.mitreTechniques,
      // Only trust the model's indicators when it actually fetched the article;
      // on a feed-only fallback the pipeline re-derives IOCs from a scrape.
      llmIndicators: out.fetchStatus === "full" ? p.indicators : undefined,
      fetchedText: out.fetchStatus === "full" ? out.fetchedText : null,
      fetchStatus: out.fetchStatus,
    };
  }

  /**
   * Classify one candidate in two stages: a cheap title/description screen that
   * filters obvious non-intelligence, then - only for survivors - the full
   * fetch-and-analyse pass. Returns the enriched item, a drop (with the reason,
   * for the audit), or "unavailable" when the call fails or cannot be parsed (so
   * callers can apply a keep-by-default / rules-fallback policy).
   *
   * The screen can only ever save work: if it is unavailable or unsure the
   * candidate proceeds to the full pass. A candidate is likewise never dropped
   * solely because the fetch fell back to the RSS feed - relevance is judged on
   * whatever content was available.
   */
  async classify(c: RawCandidate): Promise<LlmVerdict> {
    if (!c.title || !c.url) return "drop";
    try {
      // Stage 1 - cheap screen. null (failed/unparseable) means proceed.
      const screened = await this.agent.screen(c);
      if (screened && !screened.keep) {
        return {
          drop: true,
          reason: `screened out: ${screened.reason || "not intelligence"}`,
        };
      }
      // Stage 2 - fetch and analyse the article.
      const out = await this.agent.triageWithFetch(c);
      if (!out.parsed) return "unavailable";
      if (!out.parsed.relevant)
        return {
          drop: true,
          reason: out.parsed.reason
            ? `LLM: ${out.parsed.reason}`
            : "LLM: not intelligence",
        };
      return this.toItem(c, out);
    } catch {
      return "unavailable";
    }
  }

  async enrich(c: RawCandidate): Promise<EnrichedItem | null> {
    const r = await this.classify(c);
    if (r === "drop") return null;
    if (r === "unavailable") return this.fallback.enrich(c);
    if (typeof r === "object" && "drop" in r) return null;
    return r;
  }
}
