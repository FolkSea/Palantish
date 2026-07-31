import { describe, it, expect, vi } from "vitest";
import { HybridEnricher, type LlmClassifier } from "@/lib/ingest/enrich/hybrid";
import { catalogueGroups } from "./helpers/catalogue";
import type { EnrichedItem, RawCandidate } from "@/lib/ingest/types";

// Actor identification comes from the real catalogue (single source of truth).
const groups = catalogueGroups();

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
    const h = new HybridEnricher({ classify: spy }, groups);
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
      labels: [],
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

describe("HybridEnricher (llm-first)", () => {
  const llmItem = (over: Partial<EnrichedItem> = {}): EnrichedItem => ({
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
    labels: [],
    ...over,
  });

  it("uses the LLM verdict for every item, even one the rules would classify", async () => {
    const item = llmItem();
    const spy = vi.fn(async () => item);
    const h = new HybridEnricher({ classify: spy }, groups, undefined, "llm-first");
    // A candidate the rules would confidently classify still goes to the LLM.
    const out = await h.enrich(
      candidate({ title: "Volt Typhoon targets critical infrastructure" }),
    );
    expect(spy).toHaveBeenCalledOnce();
    expect(out).toBe(item);
  });

  it("pre-gates obvious marketing without paying for an LLM call", async () => {
    const spy = vi.fn(async () => llmItem());
    const h = new HybridEnricher({ classify: spy }, groups, undefined, "llm-first");
    const out = await h.enrich(
      candidate({ title: "Register now for our product webinar" }),
    );
    expect(out).toBeNull();
    // The whole point of the gate: no fetch-and-analyse call was made.
    expect(spy).not.toHaveBeenCalled();
  });

  it("pre-gates a candidate missing a title or URL", async () => {
    const spy = vi.fn(async () => llmItem());
    const h = new HybridEnricher({ classify: spy }, groups, undefined, "llm-first");
    expect(await h.enrich(candidate({ title: "" }))).toBeNull();
    expect(await h.enrich(candidate({ url: "" }))).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not pre-gate genuine reporting - it still reaches the LLM", async () => {
    const item = llmItem();
    const spy = vi.fn(async () => item);
    const h = new HybridEnricher({ classify: spy }, groups, undefined, "llm-first");
    const out = await h.enrich(
      candidate({ title: "Volt Typhoon targets critical infrastructure" }),
    );
    expect(spy).toHaveBeenCalledOnce();
    expect(out).toBe(item);
  });

  it("honours an LLM drop", async () => {
    const h = new HybridEnricher(
      { classify: vi.fn(async () => "drop" as const) },
      groups,
      undefined,
      "llm-first",
    );
    expect(await h.enrich(candidate({ title: "Anything" }))).toBeNull();
  });

  it("falls back to the rules when the LLM is unavailable", async () => {
    const h = new HybridEnricher(
      { classify: vi.fn(async () => "unavailable" as const) },
      groups,
      undefined,
      "llm-first",
    );
    // Rules drop clear marketing...
    expect(
      await h.enrich(candidate({ title: "Register now for our product webinar" })),
    ).toBeNull();
    // ...and keep a confident actor match.
    const kept = await h.enrich(
      candidate({ title: "Volt Typhoon targets critical infrastructure" }),
    );
    expect(kept?.itemType).toBe("actor_activity");
    expect(kept?.nexus).toBe("china");
  });

  it("canonicalises the LLM adversary name against the catalogue", async () => {
    const spy = vi.fn(async () => llmItem({ crowdstrikeAdversary: "Volt Typhoon" }));
    const h = new HybridEnricher({ classify: spy }, groups, undefined, "llm-first");
    const out = await h.enrich(candidate({ title: "Some report" }));
    // "Volt Typhoon" is a catalogue alias of VANGUARD PANDA.
    expect(out?.crowdstrikeAdversary).toBe("VANGUARD PANDA");
  });
});
