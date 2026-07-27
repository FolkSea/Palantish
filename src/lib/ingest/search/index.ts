import type { RawCandidate, SearchProvider } from "@/lib/ingest/types";
import { serverEnv } from "@/lib/env";

/**
 * Default no-op provider. When no SEARCH_API_KEY is configured, augmentation is
 * skipped gracefully and the pipeline relies on RSS/Atom feeds only.
 */
class NoopSearchProvider implements SearchProvider {
  readonly name = "noop";
  async search(): Promise<RawCandidate[]> {
    return [];
  }
}

// Additional providers can be added behind this interface (e.g. a web-search
// API) and selected when SEARCH_API_KEY is present. Kept as a no-op by default
// so the pipeline never depends on an external search service.
export function selectSearchProvider(): SearchProvider {
  if (serverEnv.searchApiKey) {
    // Placeholder: wire a real provider here when a key is configured.
    return new NoopSearchProvider();
  }
  return new NoopSearchProvider();
}
