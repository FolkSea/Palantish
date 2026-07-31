import type { Enricher, EnrichedItem, RawCandidate } from "@/lib/ingest/types";
import {
  buildReport,
  isMarketing,
  matchGroup,
  rulesClassify,
  sortGroups,
  type GroupEntry,
} from "./rules";

/** A classifier verdict: an item to keep, a drop (optionally with the reason it
 * was rejected, for the dropped-items audit), or "unavailable". */
export type LlmVerdict =
  | EnrichedItem
  | "drop"
  | "unavailable"
  | { drop: true; reason: string };

/** Minimal shape the hybrid needs from an LLM classifier (LlmEnricher fits). */
export interface LlmClassifier {
  classify(c: RawCandidate): Promise<LlmVerdict>;
}

/**
 * Which classifier leads:
 *  - "rules-first": the deterministic rules classify every candidate and only
 *    genuinely ambiguous ones are escalated to the LLM (cheap; few LLM calls);
 *  - "llm-first": the LLM classifies every candidate and the rules are the
 *    fallback when the LLM is unavailable (an LLM call per item).
 */
export type EnrichStrategy = "rules-first" | "llm-first";

/** Per-item classification decision, for logging. `via` is where the verdict
 * came from: the deterministic rules or the LLM call. */
export type EnrichReport = (r: {
  via: "rules" | "llm";
  outcome: "keep" | "drop";
  title: string;
  url: string | null;
  itemType: string | null;
  // Source + reason for the dropped-items audit; null/omitted on keep.
  sourceName?: string | null;
  reason?: string | null;
}) => void;

/**
 * Two-classifier enricher. In "rules-first" mode the rules lead and the LLM only
 * settles ambiguous items; in "llm-first" mode the LLM leads and the rules are
 * the fallback. Either way, when the LLM is unavailable or cannot decide, the
 * candidate is kept by default as a report (never dropped) - the operator can
 * hide or delete it. On an LLM keep, the adversary name is canonicalised against
 * the catalogue so attribution stays consistent with the rest of the dashboard.
 *
 * Pure orchestration (no network / server-only imports) so it is unit-testable;
 * the LLM dependency is injected. See ./select for the configured factory.
 */
export class HybridEnricher implements Enricher {
  readonly name = "hybrid";
  private groups: GroupEntry[];

  constructor(
    private llm: LlmClassifier | null,
    groups: GroupEntry[] = [],
    private report?: EnrichReport,
    private strategy: EnrichStrategy = "rules-first",
  ) {
    this.groups = sortGroups(groups);
  }

  async enrich(c: RawCandidate): Promise<EnrichedItem | null> {
    return this.strategy === "llm-first"
      ? this.enrichLlmFirst(c)
      : this.enrichRulesFirst(c);
  }

  /** Rules lead; ambiguous items escalate to the LLM. */
  private async enrichRulesFirst(c: RawCandidate): Promise<EnrichedItem | null> {
    const verdict = rulesClassify(c, this.groups);
    if (verdict.kind === "keep") {
      this.reportKeep("rules", c, verdict.item);
      return verdict.item;
    }
    if (verdict.kind === "drop") {
      this.reportDrop("rules", c, verdict.reason);
      return null;
    }
    // Ambiguous: escalate to the LLM when configured, else keep by default.
    if (this.llm) {
      const r = await this.consultLlm(c, true);
      return r === "fallthrough" ? this.keepByDefault("rules", c) : r;
    }
    return this.keepByDefault("rules", c);
  }

  /** LLM leads; the rules are the fallback when it is unavailable. */
  private async enrichLlmFirst(c: RawCandidate): Promise<EnrichedItem | null> {
    // Cheap deterministic pre-gate. Under web-fetch triage every candidate that
    // reaches the LLM costs a full fetch-and-analyse call, so the unambiguous
    // junk the rules can already recognise is dropped here rather than paying
    // for a verdict that is always the same. Only clear-cut cases are gated -
    // anything requiring judgement still goes to the LLM.
    if (!c.title || !c.url) {
      this.reportDrop("rules", c, "missing title or URL");
      return null;
    }
    if (isMarketing(c)) {
      this.reportDrop("rules", c, "marketing / product (pre-gate)");
      return null;
    }
    if (this.llm) {
      const decided = await this.consultLlm(c, false);
      if (decided !== "fallthrough") return decided;
    }
    // No LLM, or it was unavailable: fall back to the deterministic rules.
    const verdict = rulesClassify(c, this.groups);
    if (verdict.kind === "keep") {
      this.reportKeep("rules", c, verdict.item);
      return verdict.item;
    }
    if (verdict.kind === "drop") {
      this.reportDrop("rules", c, verdict.reason);
      return null;
    }
    return this.keepByDefault("rules", c);
  }

  /**
   * Run the LLM classifier. `keepOnUnavailable` controls the unavailable path:
   * rules-first keeps by default (the rules already deferred); llm-first returns
   * "fallthrough" so the caller can try the rules.
   */
  private async consultLlm(
    c: RawCandidate,
    keepOnUnavailable: boolean,
  ): Promise<EnrichedItem | null | "fallthrough"> {
    const r = await this.llm!.classify(c);
    if (r === "drop") {
      this.reportDrop("llm", c, "LLM: not intelligence");
      return null;
    }
    if (typeof r === "object" && "drop" in r) {
      this.reportDrop("llm", c, r.reason || "LLM: not intelligence");
      return null;
    }
    if (r !== "unavailable") {
      const item = this.canonicalise(r, c);
      this.reportKeep("llm", c, item);
      return item;
    }
    // Unavailable.
    if (keepOnUnavailable) return this.keepByDefault("llm", c);
    return "fallthrough";
  }

  /**
   * Align an LLM-produced adversary name to the catalogue: when the model's
   * `crowdstrikeAdversary` matches a known actor/alias, replace it with that
   * actor's canonical cryptonym (and fill an empty nexus from it). Leaves an
   * unrecognised name untouched, and never invents attribution.
   */
  private canonicalise(item: EnrichedItem, c: RawCandidate): EnrichedItem {
    if (!item.crowdstrikeAdversary) return item;
    const g = matchGroup(item.crowdstrikeAdversary.toLowerCase(), this.groups);
    if (!g?.cs) return item;
    return { ...item, crowdstrikeAdversary: g.cs, nexus: item.nexus ?? g.nexus };
  }

  private keepByDefault(via: "rules" | "llm", c: RawCandidate): EnrichedItem {
    const item = buildReport(c);
    this.reportKeep(via, c, item);
    return item;
  }

  private reportKeep(via: "rules" | "llm", c: RawCandidate, item: EnrichedItem) {
    this.report?.({
      via,
      outcome: "keep",
      title: c.title,
      url: c.url,
      itemType: item.itemType,
    });
  }

  private reportDrop(via: "rules" | "llm", c: RawCandidate, reason: string) {
    this.report?.({
      via,
      outcome: "drop",
      title: c.title,
      url: c.url,
      itemType: null,
      sourceName: c.sourceName,
      reason,
    });
  }
}
