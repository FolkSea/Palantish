import type { Nexus, Confidence } from "@/lib/badges";

export type ItemType =
  | "actor_activity"
  | "breach"
  | "vuln"
  | "report"
  | "breaking";

/** A raw feed entry before classification. */
export type RawCandidate = {
  title: string;
  url: string;
  description: string | null;
  publishedAt: Date | null;
  sourceName: string;
  sourceCategory: "vendor" | "research" | "news" | "government" | null;
};

/** A candidate that has been classified and is ready to persist. */
export type EnrichedItem = {
  title: string;
  description: string | null;
  url: string;
  publishedAt: Date;
  nexus: Nexus | null;
  itemType: ItemType;
  confidence: Confidence | null;
  crowdstrikeAdversary: string | null;
  sourceName: string;
  rawHash: string;
  // Taxonomy labels the triage agent assigned (Prefix/Value); [] from the rules.
  labels: string[];
};

/**
 * Pluggable classifier. Returns an EnrichedItem, or null to DROP the candidate
 * (marketing, product news, low-signal eCrime, etc.).
 */
export interface Enricher {
  readonly name: string;
  enrich(candidate: RawCandidate): Promise<EnrichedItem | null>;
}

/** Pluggable web-search augmentation. The default implementation is a no-op. */
export interface SearchProvider {
  readonly name: string;
  search(query: string): Promise<RawCandidate[]>;
}
