import { describe, it, expect } from "vitest";
import {
  selectCandidates,
  buildReviewPrompt,
  parseReviewResponse,
  REVIEW_BATCH,
  isNeverFlagged,
  type ReviewCandidate,
} from "@/lib/ioc-review/candidates";

const c = (
  value: string,
  iocType: string,
  reports: number,
  iocId = value,
): ReviewCandidate => ({ iocId, value, iocType, reports });

describe("selectCandidates", () => {
  it("ignores indicators that link nothing", () => {
    // A value in one report cannot invent a relationship, and there are
    // thousands of them - reviewing those would be most of the cost for none of
    // the benefit.
    const picked = selectCandidates([
      c("alone.example", "domain", 1),
      c("shared.example", "domain", 2),
    ]);
    expect(picked.map((p) => p.value)).toEqual(["shared.example"]);
  });

  it("never reviews CVEs or techniques", () => {
    // Reports sharing a CVE is the system working. Asking a model to second
    // guess that wastes the batch and invites it to flag real data.
    const picked = selectCandidates([
      c("CVE-2026-0400", "cve", 13),
      c("T1059", "mitre", 9),
      c("evil.example", "domain", 2),
    ]);
    expect(picked.map((p) => p.value)).toEqual(["evil.example"]);
  });

  it("spends the batch on the most connected first", () => {
    const picked = selectCandidates(
      [c("a.example", "domain", 2), c("b.example", "domain", 20)],
      { limit: 1 },
    );
    expect(picked.map((p) => p.value)).toEqual(["b.example"]);
  });

  it("orders deterministically when the counts tie", () => {
    const picked = selectCandidates([
      c("b.example", "domain", 5),
      c("a.example", "domain", 5),
    ]);
    expect(picked.map((p) => p.value)).toEqual(["a.example", "b.example"]);
  });

  it("caps the batch", () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      c(`h${i}.example`, "domain", 2 + (i % 5)),
    );
    expect(selectCandidates(many)).toHaveLength(REVIEW_BATCH);
  });
});

describe("buildReviewPrompt", () => {
  it("gives the model the type and the reach of each value", () => {
    const text = buildReviewPrompt([c("support.apple.com", "domain", 7)]);
    expect(text).toContain("[domain] support.apple.com");
    expect(text).toContain("in 7 reports");
  });
});

describe("parseReviewResponse", () => {
  const batch = [c("7.0.9.1", "ip", 4), c("evil.example", "domain", 3)];

  it("reads a clean reply", () => {
    const out = parseReviewResponse(
      '{"flagged":[{"value":"7.0.9.1","category":"version-number","reason":"A software version, not an address."}]}',
      batch,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      value: "7.0.9.1",
      category: "version-number",
      suspect: true,
    });
  });

  it("copes with fences and commentary around the JSON", () => {
    const out = parseReviewResponse(
      'Sure - here you go:\n```json\n{"flagged":[{"value":"7.0.9.1","category":"version-number","reason":"x"}]}\n```\nHope that helps.',
      batch,
    );
    expect(out.map((o) => o.value)).toEqual(["7.0.9.1"]);
  });

  it("drops a value that was not in the batch", () => {
    // A hallucinated indicator would otherwise become a row an administrator is
    // asked to act on, pointing at nothing.
    const out = parseReviewResponse(
      '{"flagged":[{"value":"never-sent.example","category":"x","reason":"y"}]}',
      batch,
    );
    expect(out).toEqual([]);
  });

  it("matches case-insensitively but stores the value we hold", () => {
    const out = parseReviewResponse(
      '{"flagged":[{"value":"EVIL.EXAMPLE","category":"x","reason":"y"}]}',
      batch,
    );
    expect(out.map((o) => o.value)).toEqual(["evil.example"]);
  });

  it("does not flag the same indicator twice", () => {
    const out = parseReviewResponse(
      '{"flagged":[{"value":"7.0.9.1","category":"a","reason":"1"},{"value":"7.0.9.1","category":"b","reason":"2"}]}',
      batch,
    );
    expect(out).toHaveLength(1);
  });

  it("returns nothing rather than throwing on a broken reply", () => {
    // A bad reply should cost one run's findings, not the ingest that called it.
    for (const bad of [
      "",
      "no json here",
      "{ not json",
      '{"flagged":"not an array"}',
      "{}",
    ]) {
      expect(parseReviewResponse(bad, batch), bad).toEqual([]);
    }
  });

  it("survives a value containing braces or quotes", () => {
    const tricky = [c('https://x.example/a?q={"b":1}', "uri", 2)];
    const out = parseReviewResponse(
      '{"flagged":[{"value":"https://x.example/a?q={\\"b\\":1}","category":"c","reason":"r"}]}',
      tricky,
    );
    expect(out).toHaveLength(1);
  });

  it("fills in a placeholder rather than storing an empty reason", () => {
    const out = parseReviewResponse(
      '{"flagged":[{"value":"7.0.9.1"}]}',
      batch,
    );
    expect(out[0].category).toBe("unclassified");
    expect(out[0].reason).toBeTruthy();
  });

  it("returns an empty list when the model finds nothing", () => {
    expect(parseReviewResponse('{"flagged":[]}', batch)).toEqual([]);
  });
});

describe("never-flag guardrail", () => {
  const batch = [
    c("github.com", "domain", 4),
    c("workers.dev", "domain", 3),
    c("google.com", "domain", 3),
    c("https://cdn.discordapp.com/attachments/1/2/p.exe", "uri", 2),
    c("evil.example", "domain", 2),
  ];

  it("refuses to surface platforms whose abuse is routine", () => {
    // The model flagged github.com and workers.dev on a real run despite the
    // prompt forbidding it. Accepting that flag would delete the indicator AND
    // allowlist the host, hiding every future indicator on it.
    const out = parseReviewResponse(
      JSON.stringify({
        flagged: [
          { value: "github.com", category: "general-purpose-platform", reason: "x" },
          { value: "workers.dev", category: "general-purpose-platform", reason: "x" },
          { value: "google.com", category: "general-purpose-service", reason: "x" },
          { value: "evil.example", category: "filename", reason: "x" },
        ],
      }),
      batch,
    );
    expect(out.map((o) => o.value)).toEqual(["evil.example"]);
  });

  it("covers subdomains of a protected host", () => {
    const out = parseReviewResponse(
      JSON.stringify({
        flagged: [
          {
            value: "https://cdn.discordapp.com/attachments/1/2/p.exe",
            category: "general-purpose-platform",
            reason: "x",
          },
        ],
      }),
      batch,
    );
    expect(out).toEqual([]);
  });

  it("protects the parent, because allowlisting one suffixes to the others", () => {
    // Blessing google.com would also silence drive.google.com, so the parent
    // has to be protected even though the bare domain looks like pure noise.
    expect(isNeverFlagged("google.com", "domain")).toBe(true);
    expect(isNeverFlagged("drive.google.com", "domain")).toBe(true);
    expect(isNeverFlagged("notgoogle.com", "domain")).toBe(false);
    expect(isNeverFlagged("google.com.evil.ru", "domain")).toBe(false);
  });
});
