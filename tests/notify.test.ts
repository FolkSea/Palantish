import { describe, it, expect } from "vitest";
import {
  labelMatches,
  matchSubscriptions,
  type NotifiableReport,
  type Subscription,
} from "@/lib/notify/match";
import { renderDigest, type DigestEntry } from "@/lib/notify/digest";

function sub(over: Partial<Subscription> & Pick<Subscription, "kind" | "value">): Subscription {
  return { id: `s-${over.kind}-${over.value}`, userId: "u1", ...over };
}

function report(over: Partial<NotifiableReport> = {}): NotifiableReport {
  return { id: "r1", labels: [], adversaries: [], country: null, ...over };
}

describe("labelMatches", () => {
  it("matches a label exactly, whatever the casing", () => {
    expect(labelMatches("Malware/BRICKSTORM", "Malware/BRICKSTORM")).toBe(true);
    expect(labelMatches("malware/brickstorm", "Malware/BRICKSTORM")).toBe(true);
  });

  it("matches a whole branch of the taxonomy", () => {
    expect(labelMatches("Malware", "Malware/BRICKSTORM")).toBe(true);
    expect(labelMatches("Target", "Target/Zimbra")).toBe(true);
  });

  it("only splits on the separator, so a name cannot half-match", () => {
    expect(labelMatches("Malware", "MalwareAnalysis")).toBe(false);
    expect(labelMatches("Mal", "Malware/BRICKSTORM")).toBe(false);
  });

  it("does not match upward: a leaf subscription ignores the branch", () => {
    expect(labelMatches("Malware/BRICKSTORM", "Malware")).toBe(false);
  });

  it("ignores blank values", () => {
    expect(labelMatches("", "Malware")).toBe(false);
    expect(labelMatches("Malware", "")).toBe(false);
  });
});

describe("matchSubscriptions", () => {
  it("matches a label subscription", () => {
    const m = matchSubscriptions(report({ labels: ["Malware/BRICKSTORM"] }), [
      sub({ kind: "label", value: "Malware" }),
    ]);
    expect(m).toHaveLength(1);
    expect(m[0].matched).toBe("Malware/BRICKSTORM");
  });

  it("matches either spelling of the adversary", () => {
    const r = report({ adversaries: ["UNID BEAR", "FANCY BEAR"] });
    expect(matchSubscriptions(r, [sub({ kind: "adversary", value: "fancy bear" })])).toHaveLength(1);
    expect(matchSubscriptions(r, [sub({ kind: "adversary", value: "UNID BEAR" })])).toHaveLength(1);
  });

  it("matches an adversary exactly, not by prefix", () => {
    const r = report({ adversaries: ["FANCY BEAR"] });
    expect(matchSubscriptions(r, [sub({ kind: "adversary", value: "FANCY" })])).toEqual([]);
  });

  it("matches a country", () => {
    expect(
      matchSubscriptions(report({ country: "Russia" }), [
        sub({ kind: "country", value: "russia" }),
      ]),
    ).toHaveLength(1);
  });

  it("does not match across kinds", () => {
    const r = report({ labels: ["Target/Zimbra"], country: "Russia" });
    expect(matchSubscriptions(r, [sub({ kind: "country", value: "Target/Zimbra" })])).toEqual([]);
    expect(matchSubscriptions(r, [sub({ kind: "label", value: "Russia" })])).toEqual([]);
  });

  it("ignores absent and blank values on the report", () => {
    const bare = report({ adversaries: [null, undefined, "  "], country: null });
    expect(matchSubscriptions(bare, [sub({ kind: "adversary", value: "FANCY BEAR" })])).toEqual([]);
    expect(matchSubscriptions(bare, [sub({ kind: "country", value: "Russia" })])).toEqual([]);
  });

  it("reports one match per subscription even when several labels sit under it", () => {
    const m = matchSubscriptions(
      report({ labels: ["Malware/BRICKSTORM", "Malware/AtlasRAT"] }),
      [sub({ kind: "label", value: "Malware" })],
    );
    expect(m).toHaveLength(1);
  });

  it("returns every distinct subscription a report satisfies", () => {
    const m = matchSubscriptions(
      report({ labels: ["Target/Zimbra"], adversaries: ["FANCY BEAR"], country: "Russia" }),
      [
        sub({ kind: "label", value: "Target" }),
        sub({ kind: "adversary", value: "FANCY BEAR" }),
        sub({ kind: "country", value: "Russia" }),
        sub({ kind: "label", value: "AI" }),
      ],
    );
    expect(m.map((x) => x.subscription.kind)).toEqual(["label", "adversary", "country"]);
  });
});

describe("renderDigest", () => {
  const APP = "https://intel.example.net";

  function entry(over: Partial<DigestEntry> = {}): DigestEntry {
    return {
      reasonKind: "label",
      reasonValue: "Malware",
      trigger: "ingest",
      title: "vSphere and BRICKSTORM Malware",
      url: "https://source.example/post",
      sourceName: "Mandiant",
      publishedAt: "2026-07-31T00:00:00.000Z",
      itemUrl: `${APP}/item/abc`,
      ...over,
    };
  }

  it("is null when nothing is owed", () => {
    expect(renderDigest([], APP)).toBeNull();
  });

  it("counts distinct reports in the subject", () => {
    expect(renderDigest([entry()], APP)?.subject).toBe(
      "1 new report matching your subscriptions",
    );
    const two = renderDigest([entry(), entry({ title: "Another" })], APP);
    expect(two?.subject).toBe("2 new reports matching your subscriptions");
  });

  it("counts one report once even when two subscriptions matched it", () => {
    const d = renderDigest(
      [entry(), entry({ reasonKind: "adversary", reasonValue: "FANCY BEAR" })],
      APP,
    );
    expect(d?.subject).toBe("1 new report matching your subscriptions");
  });

  it("groups by the subscription that matched, labels first", () => {
    const d = renderDigest(
      [
        entry({ reasonKind: "country", reasonValue: "Russia" }),
        entry({ reasonKind: "adversary", reasonValue: "FANCY BEAR" }),
        entry({ reasonKind: "label", reasonValue: "Malware" }),
      ],
      APP,
    );
    const headings = (d?.text.match(/^(Label|Adversary|Country): .*/gm) ?? []).map((h) =>
      h.split(":")[0],
    );
    expect(headings).toEqual(["Label", "Adversary", "Country"]);
  });

  it("says when a report is not new but changed", () => {
    const d = renderDigest([entry({ trigger: "labels" })], APP);
    expect(d?.text).toContain("(relabelled)");
    const a = renderDigest([entry({ trigger: "attribution" })], APP);
    expect(a?.text).toContain("(re-attributed)");
    // The ordinary case needs no explanation.
    const plain = renderDigest([entry()], APP)?.text ?? "";
    expect(plain).not.toContain("(relabelled)");
    expect(plain).not.toContain("(re-attributed)");
  });

  it("links to the report and carries source and date", () => {
    const d = renderDigest([entry()], APP);
    expect(d?.html).toContain(`href="${APP}/item/abc"`);
    expect(d?.text).toContain("Mandiant, 2026-07-31");
  });

  it("falls back to the source link when there is no item page", () => {
    const d = renderDigest([entry({ itemUrl: null })], APP);
    expect(d?.html).toContain('href="https://source.example/post"');
  });

  it("escapes markup in report titles", () => {
    const d = renderDigest([entry({ title: '<img src=x onerror="alert(1)">' })], APP);
    expect(d?.html).not.toContain("<img");
    expect(d?.html).toContain("&lt;img");
  });

  it("points back at the settings page", () => {
    const d = renderDigest([entry()], APP);
    expect(d?.text).toContain(`${APP}/settings`);
    expect(d?.html).toContain(`${APP}/settings`);
  });
});

// The Personal Feed runs the same matcher as the notification queue, so these
// pin the property that matters: what the page shows and what gets emailed are
// the same set. A report is in the feed exactly when at least one subscription
// matches it.
describe("feed and notifications agree", () => {
  const subs: Subscription[] = [
    sub({ kind: "label", value: "Malware" }),
    sub({ kind: "adversary", value: "FANCY BEAR" }),
    sub({ kind: "country", value: "Russia" }),
  ];
  const inFeed = (r: NotifiableReport) => matchSubscriptions(r, subs).length > 0;

  it("includes a report matched by any one subscription", () => {
    expect(inFeed(report({ labels: ["Malware/BRICKSTORM"] }))).toBe(true);
    expect(inFeed(report({ adversaries: ["FANCY BEAR"] }))).toBe(true);
    expect(inFeed(report({ country: "Russia" }))).toBe(true);
  });

  it("excludes a report that matches nothing", () => {
    expect(inFeed(report({ labels: ["AI/Claude"], country: "China" }))).toBe(false);
  });

  it("includes a report once, however many subscriptions it satisfies", () => {
    const r = report({
      labels: ["Malware/BRICKSTORM"],
      adversaries: ["FANCY BEAR"],
      country: "Russia",
    });
    expect(matchSubscriptions(r, subs)).toHaveLength(3);
    expect(inFeed(r)).toBe(true);
  });

  it("shows nothing when nothing is subscribed to", () => {
    expect(matchSubscriptions(report({ labels: ["Malware/X"] }), [])).toEqual([]);
  });
});
