import "server-only";

import { computeHash } from "@/lib/ingest/dedup";
import type { EnrichedItem, RawCandidate } from "@/lib/ingest/types";
import { AnalystAgent } from "@/lib/agent/analyst";
import type { WebTriageOutcome } from "@/lib/agent/web-triage";
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
export class LlmEnricher {
  readonly name = "llm";
  private agent: AnalystAgent;

  constructor(apiKey: string, memoryBrief = "") {
    this.agent = new AnalystAgent(apiKey, memoryBrief);
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
   * Fetch and classify one candidate. Cheap deterministic filtering happens in
   * HybridEnricher before this method, so every candidate reaching Claude is
   * evaluated from the fetched report rather than a second metadata-only pass.
   */
  async classify(c: RawCandidate): Promise<LlmVerdict> {
    if (!c.title || !c.url) return "drop";
    try {
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

}
