import { describe, it, expect, vi } from "vitest";
import { HybridEnricher, type LlmClassifier } from "@/lib/ingest/enrich/hybrid";
import type { EnrichedItem, RawCandidate } from "@/lib/ingest/types";

function candidate(partial: Partial<RawCandidate>): RawCandidate {
  return {
    title: "",
    url: "https://example.com/post",
    description: null,
    publishedAt: new Date("2026-07-20"),
    sourceName: "Test Source",
    sourceCategory: "news",
    ...partial,
  };
}

const neverLlm: LlmClassifier = {
  classify: vi.fn(async () => {
    throw new Error("LLM should not be called");
  }),
};

describe("HybridEnricher (rules-first)", () => {
  it("keeps a confident actor match without touching the LLM", async () => {
    const spy = vi.fn(async () => "drop" as const);
    const h = new HybridEnricher({ classify: spy });
    const out = await h.enrich(
      candidate({ title: "Volt Typhoon targets critical infrastructure" }),
    );
    expect(out?.itemType).toBe("actor_activity");
    expect(out?.nexus).toBe("china");
    expect(spy).not.toHaveBeenCalled();
  });

  it("drops clear marketing without touching the LLM", async () => {
    const h = new HybridEnricher(neverLlm);
    const out = await h.enrich(
      candidate({ title: "Register now for our product webinar" }),
    );
    expect(out).toBeNull();
  });

  it("escalates an ambiguous news post to the LLM and honours a drop", async () => {
    const spy = vi.fn(async () => "drop" as const);
    const h = new HybridEnricher({ classify: spy });
    const out = await h.enrich(
      candidate({ title: "Some ambiguous industry news item" }),
    );
    expect(spy).toHaveBeenCalledOnce();
    expect(out).toBeNull();
  });

  it("uses the LLM classification when it deems an ambiguous item relevant", async () => {
    const item: EnrichedItem = {
      title: "x",
      description: null,
      url: "u",
      publishedAt: new Date(),
      nexus: "russia",
      itemType: "actor_activity",
      confidence: "suspected",
      crowdstrikeAdversary: null,
      sourceName: "s",
      rawHash: "h",
    };
    const h = new HybridEnricher({ classify: vi.fn(async () => item) });
    const out = await h.enrich(candidate({ title: "Ambiguous item" }));
    expect(out).toBe(item);
  });

  it("includes an ambiguous item as a report when the LLM is unavailable", async () => {
    const h = new HybridEnricher({ classify: vi.fn(async () => "unavailable" as const) });
    const out = await h.enrich(
      candidate({ title: "Ambiguous item with no signal" }),
    );
    expect(out).not.toBeNull();
    expect(out?.itemType).toBe("report");
  });

  it("includes an ambiguous item as a report when there is no LLM at all", async () => {
    const h = new HybridEnricher(null);
    const out = await h.enrich(
      candidate({ title: "Ambiguous item with no signal" }),
    );
    expect(out?.itemType).toBe("report");
  });
});
