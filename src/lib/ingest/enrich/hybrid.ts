import type { Enricher, EnrichedItem, RawCandidate } from "@/lib/ingest/types";
import {
  buildReport,
  rulesClassify,
  sortGroups,
  GROUP_TABLE,
  type GroupEntry,
} from "./rules";

/** Minimal shape the hybrid needs from an LLM classifier (LlmEnricher fits). */
export interface LlmClassifier {
  classify(c: RawCandidate): Promise<EnrichedItem | "drop" | "unavailable">;
}

/**
 * Rules-first enricher. The deterministic rules classify every candidate; only
 * genuinely ambiguous ones (generic news posts with no threat signal) are
 * escalated to the LLM, which keeps LLM usage low. If the LLM is unavailable or
 * cannot decide, the candidate is included as a report (keep-by-default) rather
 * than dropped - the operator can then hide or delete it from the dashboard.
 *
 * Pure orchestration (no network / server-only imports) so it is unit-testable;
 * the LLM dependency is injected. See ./select for the configured factory.
 */
export class HybridEnricher implements Enricher {
  readonly name = "hybrid";
  private groups: GroupEntry[];

  constructor(
    private llm: LlmClassifier | null,
    extraGroups: GroupEntry[] = [],
  ) {
    this.groups = sortGroups([...extraGroups, ...GROUP_TABLE]);
  }

  async enrich(c: RawCandidate): Promise<EnrichedItem | null> {
    const verdict = rulesClassify(c, this.groups);
    if (verdict.kind === "keep") return verdict.item;
    if (verdict.kind === "drop") return null;

    // Ambiguous: escalate to the LLM when configured.
    if (this.llm) {
      const r = await this.llm.classify(c);
      if (r === "drop") return null;
      if (r !== "unavailable") return r;
    }
    // Last resort: keep it as a report so nothing is silently lost.
    return buildReport(c);
  }
}
