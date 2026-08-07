import { describe, it, expect, vi, beforeEach } from "vitest";

// Neutralise `server-only` so the (server-only) agent/enricher modules import
// under vitest, and mock the Anthropic SDK so no real API call is made.
vi.mock("server-only", () => ({}));

const create = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

import {
  parseFetchOutcome,
  parseWebTriage,
  webFetchTool,
  webFetchToolType,
  buildTriageUserMessage,
} from "@/lib/agent/web-triage";
import { reconcileIndicators } from "@/lib/agent/ioc-validate";
import { AnalystAgent } from "@/lib/agent/analyst";
import { LlmEnricher } from "@/lib/ingest/enrich/llm";
import { HybridEnricher } from "@/lib/ingest/enrich/hybrid";
import type { RawCandidate } from "@/lib/ingest/types";

const URL_UNDER_TEST = "https://vendor.example/report/apt-x";
// Padded past MIN_FETCHED_BODY_CHARS so it reads as a real article body.
const FETCHED_TEXT =
  "APT-X used ValleyRAT. C2 at 45.86.230.12 and evil.example.com, hash " +
  "d41d8cd98f00b204e9800998ecf8427e, exploiting CVE-2026-1234 via T1059.003. " +
  "The campaign targeted regional logistics operators over several months. ".repeat(10);

const TRIAGE_JSON = {
  relevant: true,
  fetchStatus: "full",
  nexus: "china",
  itemType: "actor_activity",
  dashboardKind: "research",
  confidence: "confirmed",
  crowdstrikeAdversary: "Fancy Bear",
  labels: { malware: ["ValleyRAT"], adversary: ["APT-X"], target: [], ai: [] },
  indicators: {
    ipv4: ["45.86.230.12"],
    ipv6: [],
    domains: ["evil.example.com"],
    fileHashes: ["d41d8cd98f00b204e9800998ecf8427e"],
    cves: ["CVE-2026-1234"],
  },
  mitreTechniques: ["T1059.003"],
  summary: "APT-X deployed ValleyRAT.",
  reason: null,
  evidence: [{ value: "45.86.230.12", excerpt: "C2 at 45.86.230.12" }],
};

function successContent(json: object = TRIAGE_JSON, fetchedText = FETCHED_TEXT) {
  return {
    stop_reason: "end_turn",
    content: [
      { type: "server_tool_use", name: "web_fetch", input: { url: URL_UNDER_TEST } },
      {
        type: "web_fetch_tool_result",
        content: {
          type: "web_fetch_result",
          url: URL_UNDER_TEST,
          content: { type: "document", source: { type: "text", data: fetchedText } },
        },
      },
      { type: "text", text: JSON.stringify(json) },
    ],
  };
}

function fetchErrorContent(json: object) {
  return {
    stop_reason: "end_turn",
    content: [
      { type: "server_tool_use", name: "web_fetch", input: { url: URL_UNDER_TEST } },
      {
        type: "web_fetch_tool_result",
        content: { type: "web_fetch_tool_error", error_code: "unavailable" },
      },
      { type: "text", text: JSON.stringify(json) },
    ],
  };
}

const candidate: RawCandidate = {
  title: "APT-X campaign",
  url: URL_UNDER_TEST,
  description: "feed blurb",
  publishedAt: new Date("2026-07-31"),
  sourceName: "Vendor",
  sourceCategory: "vendor",
};

beforeEach(() => create.mockReset());

describe("web_fetch tool wiring", () => {
  it("1. builds a request that enables the web_fetch tool", () => {
    const tool = webFetchTool("claude-sonnet-5", {
      allowedDomains: ["vendor.example"],
      maxContentTokens: 8000,
    });
    expect(tool.name).toBe("web_fetch");
    expect(tool.type).toMatch(/^web_fetch_/);
  });

  it("1b. selects the enhanced tool for new models, basic for old", () => {
    expect(webFetchToolType("claude-sonnet-5")).toBe("web_fetch_20260209");
    expect(webFetchToolType("claude-haiku-4-5")).toBe("web_fetch_20250910");
  });

  it("2. passes the exact report URL to Claude", async () => {
    create.mockResolvedValue(successContent());
    const agent = new AnalystAgent("sk-test");
    await agent.triageWithFetch(candidate);
    const params = create.mock.calls[0][0];
    // The web_fetch tool is declared, and the URL is in the user message.
    expect(params.tools[0].name).toBe("web_fetch");
    const userMsg = params.messages.find((m: { role: string }) => m.role === "user");
    expect(JSON.stringify(userMsg.content)).toContain(URL_UNDER_TEST);
  });

  it("8. enforces content and tool-use limits on the request", async () => {
    create.mockResolvedValue(successContent());
    const agent = new AnalystAgent("sk-test");
    await agent.triageWithFetch(candidate);
    const tool = create.mock.calls[0][0].tools[0];
    expect(typeof tool.max_content_tokens).toBe("number");
    expect(tool.max_content_tokens).toBeGreaterThan(0);
    expect(typeof tool.max_uses).toBe("number");
    // Fetch is bounded to the report's own host.
    expect(tool.allowed_domains).toContain("vendor.example");
  });
});

describe("fetchStatus is decided from the tool result, not the model's claim", () => {
  it("3. a successful web_fetch result yields fetchStatus 'full'", async () => {
    create.mockResolvedValue(successContent());
    const agent = new AnalystAgent("sk-test");
    const out = await agent.triageWithFetch(candidate);
    expect(out.fetchStatus).toBe("full");
    expect(out.parsed?.fetchStatus).toBe("full");
    expect(out.fetchedText).toContain("ValleyRAT");
  });

  it("4. a model that claims 'full' without a successful fetch cannot be 'full'", async () => {
    // Model text lies (fetchStatus:"full") but the tool result is an error.
    create.mockResolvedValue(fetchErrorContent({ ...TRIAGE_JSON, fetchStatus: "full" }));
    const agent = new AnalystAgent("sk-test");
    const out = await agent.triageWithFetch(candidate);
    expect(out.fetchStatus).toBe("feed_only");
    expect(out.parsed?.fetchStatus).toBe("feed_only");
    expect(out.fetchedText).toBeNull();
  });

  it("4b. a consent/challenge stub body does not count as a full retrieval", async () => {
    // Tool "succeeded" but returned only a short interstitial, not the article.
    create.mockResolvedValue(
      successContent({ ...TRIAGE_JSON, fetchStatus: "full" }, "Please enable JavaScript."),
    );
    const agent = new AnalystAgent("sk-test");
    const out = await agent.triageWithFetch(candidate);
    expect(out.fetchStatus).toBe("feed_only");
    expect(out.fetchedText).toBeNull();
  });

  it("parseFetchOutcome reads success + document text from the result block", () => {
    const o = parseFetchOutcome(successContent().content);
    expect(o.succeeded).toBe(true);
    expect(o.fetchedUrl).toBe(URL_UNDER_TEST);
    expect(o.text).toContain("ValleyRAT");
    const e = parseFetchOutcome(fetchErrorContent(TRIAGE_JSON).content);
    expect(e.succeeded).toBe(false);
    expect(e.errorCode).toBe("unavailable");
  });
});

describe("fallback behaviour", () => {
  it("5. a feed-only fetch is not dropped and carries no web-fetch IOCs (routes to app scrape)", async () => {
    create.mockResolvedValue(
      fetchErrorContent({ ...TRIAGE_JSON, fetchStatus: "feed_only" }),
    );
    const enricher = new LlmEnricher("sk-test");
    const item = await enricher.classify(candidate);
    expect(item).toMatchObject({ fetchStatus: "feed_only" });
    if (typeof item !== "object" || "drop" in item) throw new Error("expected item");
    expect(item.fetchStatus).toBe("feed_only");
    // No trusted IOCs -> the pipeline will fall back to the app-side scraper.
    expect(item.llmIndicators).toBeUndefined();
    expect(item.fetchedText).toBeNull();
  });

  it("10. rules enricher runs when the Anthropic API is unavailable (no LLM configured)", async () => {
    const hybrid = new HybridEnricher(null, [], undefined, "llm-first");
    const item = await hybrid.enrich({
      title: "Critical vulnerability CVE-2026-9999 in Acme VPN exploited",
      url: "https://news.example/cve",
      description: "advisory",
      publishedAt: new Date("2026-07-31"),
      sourceName: "News",
      sourceCategory: "news",
    });
    expect(item).not.toBeNull(); // classified deterministically, never web-fetched
    expect(create).not.toHaveBeenCalled();
  });

  it("10b. LLM enricher falls back to rules when triage is unavailable", async () => {
    // Unparseable response (no JSON) -> triage parsed=null -> classify
    // "unavailable" -> enrich falls back to the deterministic rules enricher.
    create.mockResolvedValue({ stop_reason: "end_turn", content: [] });
    const enricher = new HybridEnricher(
      new LlmEnricher("sk-test"),
      [],
      undefined,
      "llm-first",
    );
    const item = await enricher.enrich({
      title: "Critical vulnerability CVE-2026-9999 in Acme VPN actively exploited",
      url: "https://news.example/cve",
      description: "advisory",
      publishedAt: new Date("2026-07-31"),
      sourceName: "News",
      sourceCategory: "news",
    });
    expect(item).not.toBeNull(); // rules kept it
    expect(item!.fetchStatus).toBeUndefined(); // came from rules, not web fetch
  });
});

describe("at most one fetch per configured retrieval method", () => {
  it("9. web-fetch triage calls the Messages API exactly once", async () => {
    create.mockResolvedValue(successContent());
    const agent = new AnalystAgent("sk-test");
    await agent.triageWithFetch(candidate);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("9b. a full fetch carries the IOCs, so the pipeline does not also scrape", async () => {
    create.mockResolvedValue(successContent());
    const enricher = new LlmEnricher("sk-test");
    const item = await enricher.classify(candidate);
    if (typeof item !== "object" || "drop" in item) throw new Error("expected item");
    expect(item.fetchStatus).toBe("full");
    expect(item.llmIndicators).toBeDefined(); // pipeline uses these; no scrape
  });
});

describe("end-of-run reflection (memory writes)", () => {
  const reports = [{ title: "t", kind: "research", adversary: "FANCY BEAR" }];

  it("gets a longer timeout than per-item triage", async () => {
    create.mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: '{"adversaries":[],"trends":[]}' }],
    });
    const agent = new AnalystAgent("sk-test");
    await agent.reflect(reports, []);
    // Reflecting over a whole run cannot fit in the per-item budget; a silent
    // timeout here is why memory was never written.
    const timeout = create.mock.calls[0][1]?.timeout;
    expect(timeout).toBeGreaterThan(20000);
  });

  it("propagates failures instead of silently writing no memory", async () => {
    // A malformed response (no content block) throws inside reflect. It must
    // surface so the pipeline records it against the run, rather than being
    // swallowed into [] - which reports a successful run that wrote no memory.
    create.mockResolvedValue({ stop_reason: "end_turn" });
    const agent = new AnalystAgent("sk-test");
    let failed = false;
    try {
      await agent.reflect(reports, []);
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });
});

describe("classification, labels and IOC validation", () => {
  it("6. parses classification + canonical labels from the triage JSON", () => {
    const p = parseWebTriage(JSON.stringify(TRIAGE_JSON))!;
    expect(p.relevant).toBe(true);
    expect(p.itemType).toBe("actor_activity");
    expect(p.dashboardKind).toBe("research");
    expect(p.crowdstrikeAdversary).toBe("Fancy Bear");
    expect(p.labels).toEqual(
      expect.arrayContaining(["Malware/ValleyRAT", "Adversary/APTX"]),
    );
  });

  it("6b. validates and reconciles IOCs against the fetched text (persistable rows)", () => {
    const rows = reconcileIndicators(
      TRIAGE_JSON.indicators,
      TRIAGE_JSON.mitreTechniques,
      FETCHED_TEXT,
    );
    const byType = (t: string) => rows.filter((r) => r.ioc_type === t).map((r) => r.value);
    expect(byType("ip")).toContain("45.86.230.12");
    expect(byType("domain")).toContain("evil.example.com");
    expect(byType("file_hash")).toContain("d41d8cd98f00b204e9800998ecf8427e");
    expect(byType("cve")).toContain("CVE-2026-1234");
    expect(byType("mitre")).toContain("T1059.003");
  });

  it("7. rejects hallucinated and malformed indicators", () => {
    const rows = reconcileIndicators(
      {
        ipv4: ["203.0.113.99", "999.1.1.1"], // not in text; malformed
        ipv6: [],
        domains: ["not-in-report.example"], // hallucinated (absent from text)
        fileHashes: ["zzzz"], // malformed
        cves: ["CVE-2026-1234"], // present -> kept
      },
      ["T9999"], // malformed MITRE
      FETCHED_TEXT,
    );
    const values = rows.map((r) => r.value);
    expect(values).not.toContain("203.0.113.99");
    expect(values).not.toContain("999.1.1.1");
    expect(values).not.toContain("not-in-report.example");
    expect(values).not.toContain("zzzz");
    expect(values).not.toContain("T9999");
    expect(values).toContain("CVE-2026-1234"); // the one real, present indicator
  });

  it("7b. drops source/allow-listed infrastructure and non-routable IPs", () => {
    const text =
      "See vendor.example and evil.example.com; hosts 127.0.0.1 and 45.86.230.12.";
    const rows = reconcileIndicators(
      {
        ipv4: ["127.0.0.1", "45.86.230.12"],
        ipv6: [],
        domains: ["vendor.example", "evil.example.com"],
        fileHashes: [],
        cves: [],
      },
      [],
      text,
      { excludeDomains: ["vendor.example"] },
    );
    const values = rows.map((r) => r.value);
    expect(values).not.toContain("127.0.0.1"); // non-routable
    expect(values).not.toContain("vendor.example"); // allow-listed / source
    expect(values).toContain("45.86.230.12");
    expect(values).toContain("evil.example.com");
  });

  it("7c. ignores site-chrome markdown links in the deterministic pass", () => {
    // web_fetch markdown: nav/ad/image links must not become IOCs, while prose
    // indicators (incl. defanged ones the model missed) are still captured.
    const md =
      "[Subscribe](https://ads.tracker.example/serve;ID=269a8aff73d4feb8e5383e0565f15df5) " +
      "![logo](https://cdn.chrome.example/logo-270x270.jpeg)\n" +
      "The implant beacons to hxxp://evil[.]example/gate and 45.86.230.12.";
    const rows = reconcileIndicators(
      { ipv4: [], ipv6: [], domains: [], fileHashes: [], cves: [] },
      [],
      md,
    );
    const values = rows.map((r) => r.value);
    expect(values).toContain("45.86.230.12");
    // The URL is no longer an indicator; its host, refanged, still is.
    expect(values).toContain("evil.example");
    expect(values.some((v) => v.includes("ads.tracker.example"))).toBe(false);
    expect(values.some((v) => v.includes("cdn.chrome.example"))).toBe(false);
    expect(values).not.toContain("269a8aff73d4feb8e5383e0565f15df5"); // hex in ad URL
  });

  it("buildTriageUserMessage includes the URL and instructs a fetch", () => {
    const msg = buildTriageUserMessage(candidate);
    expect(msg).toContain(URL_UNDER_TEST);
    expect(msg.toLowerCase()).toContain("web_fetch");
  });
});
