import { describe, it, expect } from "vitest";
import { parseQuery, fieldsUsed, type QueryNode } from "@/lib/search/query";
import {
  matchesDoc,
  evaluateQuery,
  toDoc,
  type SearchDoc,
  type CorpusRow,
} from "@/lib/search/evaluate";

/** Parse and assert success, so the tests read as one line per case. */
function parse(q: string): QueryNode {
  const r = parseQuery(q);
  if (!r.ok) throw new Error(`expected "${q}" to parse, got: ${r.error}`);
  return r.node;
}

function doc(over: Partial<SearchDoc> = {}): SearchDoc {
  return {
    id: "1",
    text: [],
    source: null,
    adversary: [],
    labels: [],
    ip: [],
    domain: [],
    url: [],
    hash: [],
    cve: [],
    ttp: [],
    ...over,
  };
}

describe("parseQuery: fields", () => {
  it("reads a field term", () => {
    expect(parse("label:Malware")).toEqual({
      type: "term",
      field: "label",
      matcher: { kind: "contains", value: "malware" },
    });
  });

  it("accepts each documented field and its aliases", () => {
    const cases: [string, string][] = [
      ["label:x", "label"],
      ["tag:x", "label"],
      ["adv:x", "adversary"],
      ["adversary:x", "adversary"],
      ["actor:x", "adversary"],
      ["ttp:x", "ttp"],
      ["mitre:x", "ttp"],
      ["technique:x", "ttp"],
      ["cve:x", "cve"],
      ["ip:x", "ip"],
      ["dom:x", "domain"],
      ["domain:x", "domain"],
      ["url:x", "url"],
      ["uri:x", "url"],
      ["hash:x", "hash"],
      ["file:x", "hash"],
      ["ioc:x", "ioc"],
      ["src:x", "source"],
      ["source:x", "source"],
      ["text:x", "text"],
    ];
    for (const [query, field] of cases) {
      const node = parse(query);
      expect(node, query).toMatchObject({ type: "term", field });
    }
  });

  it("is case-insensitive about field names", () => {
    expect(parse("LABEL:x")).toMatchObject({ field: "label" });
    expect(parse("Adv:x")).toMatchObject({ field: "adversary" });
  });

  it("treats a bare word as a text search", () => {
    expect(parse("zimbra")).toEqual({
      type: "term",
      field: "text",
      matcher: { kind: "contains", value: "zimbra" },
    });
  });

  it("leaves an unknown prefix as literal text, so URLs still search", () => {
    expect(parse("https://evil.example.com")).toMatchObject({
      field: "text",
      matcher: { kind: "contains", value: "https://evil.example.com" },
    });
    expect(parse("ratio:3")).toMatchObject({ field: "text" });
  });

  it("reads a quoted value with spaces", () => {
    expect(parse('label:"Target/F5 BIG-IP"')).toMatchObject({
      field: "label",
      matcher: { kind: "contains", value: "target/f5 big-ip" },
    });
    expect(parse('"lateral movement"')).toMatchObject({
      field: "text",
      matcher: { kind: "contains", value: "lateral movement" },
    });
  });

  it("normalises a defanged indicator to its stored form", () => {
    expect(parse("dom:evil[.]com")).toMatchObject({
      matcher: { kind: "contains", value: "evil.com" },
    });
    expect(parse("url:hxxps://evil[.]com/a")).toMatchObject({
      matcher: { kind: "contains", value: "https://evil.com/a" },
    });
    // Defanging is for indicators only; a label is matched as typed.
    expect(parse("label:a[.]b")).toMatchObject({
      matcher: { kind: "contains", value: "a[.]b" },
    });
  });
});

describe("parseQuery: boolean logic", () => {
  it("ANDs adjacent terms implicitly", () => {
    expect(parse("zimbra label:Malware")).toMatchObject({
      type: "and",
      children: [{ field: "text" }, { field: "label" }],
    });
  });

  it("reads explicit AND, OR and NOT", () => {
    expect(parse("a AND b")).toMatchObject({ type: "and" });
    expect(parse("a OR b")).toMatchObject({ type: "or" });
    expect(parse("NOT a")).toMatchObject({ type: "not" });
    expect(parse("a && b")).toMatchObject({ type: "and" });
    expect(parse("a || b")).toMatchObject({ type: "or" });
  });

  it("reads - and ! as negation", () => {
    expect(parse("-label:AI/Claude")).toMatchObject({
      type: "not",
      child: { field: "label" },
    });
    expect(parse("!zimbra")).toMatchObject({ type: "not" });
  });

  it("does not mistake a hyphen inside a value for negation", () => {
    expect(parse("cve:CVE-2026-42897")).toMatchObject({
      type: "term",
      matcher: { kind: "contains", value: "cve-2026-42897" },
    });
    expect(parse("adv:FANCY-BEAR")).toMatchObject({ type: "term" });
  });

  it("binds OR looser than AND", () => {
    // a AND b OR c  ==  (a AND b) OR c
    expect(parse("a b OR c")).toMatchObject({
      type: "or",
      children: [{ type: "and" }, { type: "term" }],
    });
  });

  it("groups with brackets", () => {
    expect(parse("(a OR b) c")).toMatchObject({
      type: "and",
      children: [{ type: "or" }, { type: "term" }],
    });
  });

  it("keeps operator words case-insensitive but only as whole words", () => {
    expect(parse("a or b")).toMatchObject({ type: "or" });
    // "android" is a keyword, not an OR.
    expect(parse("android")).toMatchObject({ type: "term", field: "text" });
  });
});

describe("parseQuery: regex", () => {
  it("builds a case-insensitive regex for :~", () => {
    const node = parse("dom:~evil\\.(ru|su)$");
    expect(node).toMatchObject({ field: "domain", matcher: { kind: "regex" } });
    const m = (node as { matcher: { re: RegExp } }).matcher;
    expect(m.re.test("bad-evil.ru")).toBe(true);
    expect(m.re.test("EVIL.SU")).toBe(true);
    expect(m.re.test("evil.com")).toBe(false);
  });

  it("supports regex on every field, quoted when it has spaces", () => {
    expect(parse("label:~^Malware/")).toMatchObject({ field: "label" });
    expect(parse('text:~"lateral (movement|transfer)"')).toMatchObject({
      field: "text",
      matcher: { kind: "regex" },
    });
  });

  it("tells a regex group apart from a query group", () => {
    // The pattern's own brackets are consumed; the one that closes the query
    // group is not, because nothing in the pattern is left open.
    const node = parse("(dom:~evil\\.(ru|su)) OR zimbra");
    expect(node).toMatchObject({
      type: "or",
      children: [{ type: "term", field: "domain" }, { type: "term", field: "text" }],
    });
    const m = (node as { children: { matcher: { source: string } }[] }).children[0]
      .matcher;
    expect(m.source).toBe("evil\\.(ru|su)");
  });

  it("reports an invalid pattern instead of throwing", () => {
    const r = parseQuery("dom:~[unclosed");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("not a valid regular expression");
  });

  it("refuses a pattern long enough to be worth backtracking", () => {
    const r = parseQuery(`text:~${"(a+)+".repeat(50)}`);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("limited to");
  });
});

describe("parseQuery: wildcards", () => {
  const re = (q: string) => (parse(q) as { matcher: { re: RegExp } }).matcher.re;

  it("treats a value with * as a pattern, not a substring", () => {
    expect(parse("label:Malware/*")).toMatchObject({
      field: "label",
      matcher: { kind: "glob" },
    });
    // No star, no change: plain values stay a substring match.
    expect(parse("label:Malware")).toMatchObject({ matcher: { kind: "contains" } });
  });

  it("anchors at both ends, so a branch is that branch", () => {
    const m = re("label:Malware/*");
    expect(m.test("Malware/BRICKSTORM")).toBe(true);
    expect(m.test("Malware/")).toBe(true);
    // Substring semantics would have matched these; a glob must not.
    expect(m.test("NotMalware/X")).toBe(false);
    expect(m.test("Malware")).toBe(false);
  });

  it("matches a suffix, a prefix and a middle", () => {
    expect(re("adv:*BEAR").test("FANCY BEAR")).toBe(true);
    expect(re("adv:*BEAR").test("BEAR CLAW")).toBe(false);
    expect(re("adv:FANCY*").test("FANCY BEAR")).toBe(true);
    expect(re("dom:evil*.ru").test("evil-c2.ru")).toBe(true);
    expect(re("dom:evil*.ru").test("evil-c2.su")).toBe(false);
    expect(re("adv:*BEAR*").test("THE BEAR CLAW")).toBe(true);
  });

  it("is case-insensitive, like the substring match it replaces", () => {
    expect(re("label:malware/*").test("Malware/BRICKSTORM")).toBe(true);
  });

  it("keeps everything else literal, so a value cannot act as a regex", () => {
    // "." must be a dot, not "any character", or dom:evil*.ru would match
    // "evil-c2Xru" and the wildcard would quietly be a regex.
    expect(re("dom:evil*.ru").test("evilXru")).toBe(false);
    expect(re("cve:CVE-2026-*").test("CVE-2026-42897")).toBe(true);
    expect(re("text:a+b*").test("a+because")).toBe(true);
    expect(re("text:a+b*").test("aaab")).toBe(false);
  });

  it("normalises a defanged indicator before compiling the pattern", () => {
    expect(re("dom:evil[.]example[.]*").test("evil.example.ru")).toBe(true);
  });

  it("refuses a chain of wildcards long enough to backtrack badly", () => {
    const r = parseQuery(`text:${"*a".repeat(20)}`);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("at most");
  });

  it("works inside quotes, where a value can hold spaces", () => {
    expect(re('adv:"FANCY *"').test("FANCY BEAR")).toBe(true);
  });
});

describe("parseQuery: errors", () => {
  it("names what is wrong", () => {
    const cases: [string, string][] = [
      ["", "Enter something"],
      ["label:", "needs a value"],
      ["(a OR b", "Unclosed bracket"],
      ["a OR b)", "Unbalanced closing bracket"],
      ['label:"unterminated', "Unclosed quote"],
      ["a AND", "ends with an operator"],
    ];
    for (const [query, fragment] of cases) {
      const r = parseQuery(query);
      expect(r.ok, query).toBe(false);
      expect(r.ok === false && r.error, query).toContain(fragment);
    }
  });
});

describe("fieldsUsed", () => {
  it("reports every field the query touches", () => {
    expect([...fieldsUsed(parse("zimbra"))]).toEqual(["text"]);
    expect([...fieldsUsed(parse("label:x AND NOT (ip:1 OR adv:y))".slice(0, -1)))].sort()).toEqual(
      ["adversary", "ip", "label"],
    );
  });
});

describe("matchesDoc", () => {
  const report = doc({
    text: ["Russian Hackers Exploit OWA Flaw", "Targets government mailboxes"],
    source: "The Hacker News",
    adversary: ["FANCY BEAR"],
    labels: ["Malware/ZimReaper", "Target/Zimbra", "AI/Claude"],
    ip: ["91.108.106.229"],
    domain: ["evil.example.ru"],
    url: ["https://evil.example.ru/panel"],
    hash: ["d41d8cd98f00b204e9800998ecf8427e"],
    cve: ["CVE-2026-42897"],
    ttp: ["T1059.001"],
  });

  it("matches a substring, case-insensitively, on every field", () => {
    for (const q of [
      "russian",
      "label:zimbra",
      "adv:fancy",
      "src:hacker",
      'src:"hacker news"',
      "ip:91.108",
      "dom:example.ru",
      "url:/panel",
      "hash:d41d8cd9",
      "cve:2026-42897",
      "ttp:T1059",
      "ioc:91.108.106.229",
    ]) {
      expect(matchesDoc(parse(q), report), q).toBe(true);
    }
  });

  it("does not match across fields", () => {
    expect(matchesDoc(parse("label:FANCY"), report)).toBe(false);
    expect(matchesDoc(parse("ip:evil.example.ru"), report)).toBe(false);
    // ioc: is the deliberate exception - any indicator type.
    expect(matchesDoc(parse("ioc:evil.example.ru"), report)).toBe(true);
  });

  it("matches a defanged query against the stored value", () => {
    expect(matchesDoc(parse("dom:evil[.]example[.]ru"), report)).toBe(true);
    expect(matchesDoc(parse("ip:91[.]108[.]106[.]229"), report)).toBe(true);
  });

  it("applies AND, OR and NOT", () => {
    expect(matchesDoc(parse("label:Zimbra adv:FANCY"), report)).toBe(true);
    expect(matchesDoc(parse("label:Zimbra adv:COZY"), report)).toBe(false);
    expect(matchesDoc(parse("adv:COZY OR label:Zimbra"), report)).toBe(true);
    expect(matchesDoc(parse("label:Zimbra NOT adv:FANCY"), report)).toBe(false);
    expect(matchesDoc(parse("label:Zimbra -adv:COZY"), report)).toBe(true);
  });

  it("honours bracketed grouping", () => {
    expect(matchesDoc(parse("(adv:COZY OR adv:FANCY) label:Zimbra"), report)).toBe(true);
    expect(matchesDoc(parse("(adv:COZY OR adv:VOODOO) label:Zimbra"), report)).toBe(false);
  });

  it("applies a regex to the field's values", () => {
    expect(matchesDoc(parse("dom:~\\.(ru|su)$"), report)).toBe(true);
    expect(matchesDoc(parse("dom:~\\.(cn|kp)$"), report)).toBe(false);
    expect(matchesDoc(parse("ttp:~^T1059\\.\\d{3}$"), report)).toBe(true);
    expect(matchesDoc(parse("label:~^Malware/"), report)).toBe(true);
    expect(matchesDoc(parse("label:~^Malware$"), report)).toBe(false);
  });

  it("negates over a report with no values for the field", () => {
    const bare = doc({ text: ["Nothing here"] });
    expect(matchesDoc(parse("NOT label:anything"), bare)).toBe(true);
    expect(matchesDoc(parse("NOT ip:1.2.3.4"), bare)).toBe(true);
  });
});

describe("evaluateQuery", () => {
  const corpus: SearchDoc[] = [
    doc({ id: "a", text: ["Zimbra zero-day"], labels: ["Target/Zimbra"] }),
    doc({ id: "b", text: ["Zimbra patch notes"], labels: ["AI/Claude"] }),
    doc({ id: "c", text: ["Unrelated"], labels: ["Target/Zimbra"] }),
  ];

  it("returns every matching report, in corpus order", () => {
    expect(evaluateQuery(parse("zimbra"), corpus).map((d) => d.id)).toEqual(["a", "b"]);
    expect(
      evaluateQuery(parse("zimbra NOT label:AI/Claude"), corpus).map((d) => d.id),
    ).toEqual(["a"]);
    expect(
      evaluateQuery(parse("label:Target/Zimbra OR label:AI/Claude"), corpus).map(
        (d) => d.id,
      ),
    ).toEqual(["a", "b", "c"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(evaluateQuery(parse("label:Malware/None"), corpus)).toEqual([]);
  });
});

describe("toDoc", () => {
  const row: CorpusRow = {
    id: "1",
    kind: "exploit",
    title: "Zimbra RCE",
    url: null,
    description: "Exploited in the wild",
    source_name: "The Record",
    published_at: null,
    raw_hash: "h",
    cve_id: "CVE-2026-42897",
    target: "Zimbra Collaboration",
    exploit_status: "confirmed",
    date_label: null,
    country: "Russia",
    confidence: "medium",
    adversary_label: "UNID BEAR",
    crowdstrike_adversary: "FANCY BEAR",
  };

  it("sorts indicators into their fields by stored type", () => {
    const d = toDoc(row, ["Target/Zimbra"], [
      { type: "ip", value: "1.2.3.4" },
      { type: "domain", value: "evil.ru" },
      { type: "uri", value: "https://evil.ru/a" },
      { type: "file_hash", value: "abc123" },
      { type: "cve", value: "CVE-2026-1111" },
      { type: "mitre", value: "T1059" },
    ]);
    expect(d.ip).toEqual(["1.2.3.4"]);
    expect(d.domain).toEqual(["evil.ru"]);
    expect(d.url).toEqual(["https://evil.ru/a"]);
    expect(d.hash).toEqual(["abc123"]);
    expect(d.ttp).toEqual(["T1059"]);
    expect(d.labels).toEqual(["Target/Zimbra"]);
    // The item's own cve_id counts as a CVE alongside any linked indicator.
    expect(d.cve).toEqual(["CVE-2026-42897", "CVE-2026-1111"]);
  });

  it("searches both spellings of the adversary", () => {
    const d = toDoc(row, [], []);
    expect(matchesDoc(parse("adv:UNID"), d)).toBe(true);
    expect(matchesDoc(parse("adv:FANCY"), d)).toBe(true);
  });

  it("keeps the exploit fields searchable as free text", () => {
    const d = toDoc(row, [], []);
    expect(matchesDoc(parse("collaboration"), d)).toBe(true);
    expect(matchesDoc(parse("CVE-2026-42897"), d)).toBe(true);
  });
});
