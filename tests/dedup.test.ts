import { describe, it, expect } from "vitest";
import { computeHash, selectNewCandidates } from "@/lib/ingest/dedup";
import type { RawCandidate } from "@/lib/ingest/types";

function candidate(title: string, url: string): RawCandidate {
  return {
    title,
    url,
    description: null,
    publishedAt: null,
    sourceName: "Test",
    sourceCategory: "news",
  };
}

describe("computeHash", () => {
  it("is stable regardless of case and surrounding whitespace", () => {
    expect(computeHash("Volt Typhoon", "https://x/y")).toBe(
      computeHash("  volt   typhoon ", "HTTPS://X/Y".toLowerCase()),
    );
  });

  it("differs when title or url differs", () => {
    expect(computeHash("a", "https://x")).not.toBe(
      computeHash("b", "https://x"),
    );
    expect(computeHash("a", "https://x")).not.toBe(
      computeHash("a", "https://y"),
    );
  });
});

describe("selectNewCandidates", () => {
  it("filters out already-seen hashes", () => {
    const c = candidate("Lazarus campaign", "https://a");
    const existing = new Set([computeHash(c.title, c.url)]);
    expect(selectNewCandidates([c], existing)).toHaveLength(0);
  });

  it("collapses duplicates within the same batch", () => {
    const batch = [
      candidate("APT29 phishing", "https://a"),
      candidate("APT29 phishing", "https://a"),
      candidate("Different", "https://b"),
    ];
    const out = selectNewCandidates(batch, new Set());
    expect(out).toHaveLength(2);
  });

  it("tags each returned candidate with its hash", () => {
    const out = selectNewCandidates([candidate("t", "https://u")], new Set());
    expect(out[0].rawHash).toBe(computeHash("t", "https://u"));
  });
});
