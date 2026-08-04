import "server-only";

import type { Enricher } from "@/lib/ingest/types";
import { HybridEnricher, type EnrichReport } from "./hybrid";
import { LlmEnricher } from "./llm";
import { RulesEnricher, type GroupEntry } from "./rules";
import { serverEnv } from "@/lib/env";

export function selectEnricher(
  extraGroups: GroupEntry[] = [],
  report?: EnrichReport,
  memoryBrief = "",
): Enricher {
  const key = serverEnv.anthropicApiKey;
  return new HybridEnricher(
    key ? new LlmEnricher(key, memoryBrief, extraGroups) : null,
    extraGroups,
    report,
    serverEnv.enrichStrategy,
  );
}

export { HybridEnricher, RulesEnricher };
