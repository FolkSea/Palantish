import "server-only";

import type { Enricher } from "@/lib/ingest/types";
import { HybridEnricher, type EnrichReport } from "./hybrid";
import { LlmEnricher } from "./llm";
import { RulesEnricher, type GroupEntry } from "./rules";
import { serverEnv } from "@/lib/env";

/**
 * Chooses the enricher for the pipeline: rules-first, with the LLM used only
 * for edge cases and configured from the environment. When no API key is set,
 * ambiguous items are kept as reports (no LLM to consult).
 */
export function selectEnricher(
  extraGroups: GroupEntry[] = [],
  report?: EnrichReport,
  memoryBrief = "",
): Enricher {
  const key = serverEnv.anthropicApiKey;
  return new HybridEnricher(
    key ? new LlmEnricher(key, extraGroups, memoryBrief) : null,
    extraGroups,
    report,
  );
}

export { HybridEnricher, RulesEnricher };
