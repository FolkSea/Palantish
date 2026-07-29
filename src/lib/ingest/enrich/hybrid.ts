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

/** Per-item classification decision, for logging. `via` is where the verdict
 * came from: the deterministic rules or the escalated LLM call. */
export type EnrichReport = (r: {
  via: "rules" | "llm";
  outcome: "keep" | "drop";
  title: string;
  itemType: string | null;
}) => void;

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
    private report?: EnrichReport,
  ) {
    this.groups = sortGroups([...extraGroups, ...GROUP_TABLE]);
  }

  async enrich(c: RawCandidate): Promise<EnrichedItem | null> {
    const verdict = rulesClassify(c, this.groups);
    if (verdict.kind === "keep") {
      this.report?.({ via: "rules", outcome: "keep", title: c.title, itemType: verdict.item.itemType });
      return verdict.item;
    }
    if (verdict.kind === "drop") {
      this.report?.({ via: "rules", outcome: "drop", title: c.title, itemType: null });
      return null;
    }

    // Ambiguous: escalate to the LLM when configured.
    if (this.llm) {
      const r = await this.llm.classify(c);
      if (r === "drop") {
        this.report?.({ via: "llm", outcome: "drop", title: c.title, itemType: null });
        return null;
      }
      if (r !== "unavailable") {
        this.report?.({ via: "llm", outcome: "keep", title: c.title, itemType: r.itemType });
        return r;
      }
      // LLM was consulted but unavailable: keep-by-default as a report.
      const item = buildReport(c);
      this.report?.({ via: "llm", outcome: "keep", title: c.title, itemType: item.itemType });
      return item;
    }
    // No LLM configured: keep the ambiguous item locally as a report.
    const item = buildReport(c);
    this.report?.({ via: "rules", outcome: "keep", title: c.title, itemType: item.itemType });
    return item;
  }
}
