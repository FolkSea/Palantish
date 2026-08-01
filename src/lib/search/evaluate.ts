// Evaluate a parsed search query against a corpus of reports.
//
// Set algebra over report ids rather than a translated SQL predicate: NOT and
// OR across the label and indicator join tables have no clean PostgREST
// expression, and regex has none at all. The corpus is loaded once (see
// corpus.ts) and every term is answered from it, so the boolean semantics are
// exactly what the grammar says.

import {
  matchesAny,
  type Field,
  type Matcher,
  type QueryNode,
} from "@/lib/search/query";

/** Everything about one report the query language can match on. */
export type SearchDoc = {
  id: string;
  /** Free-text haystacks: title, description, and the exploit fields. */
  text: string[];
  source: string | null;
  adversary: string[];
  labels: string[];
  /** Indicator values by type, as stored (fanged). */
  ip: string[];
  domain: string[];
  url: string[];
  hash: string[];
  cve: string[];
  ttp: string[];
};

/** The values a field matches against for one report. */
function valuesFor(doc: SearchDoc, field: Field): readonly (string | null)[] {
  switch (field) {
    case "text":
      return doc.text;
    case "source":
      return [doc.source];
    case "adversary":
      return doc.adversary;
    case "label":
      return doc.labels;
    case "ip":
      return doc.ip;
    case "domain":
      return doc.domain;
    case "url":
      return doc.url;
    case "hash":
      return doc.hash;
    case "cve":
      return doc.cve;
    case "ttp":
      return doc.ttp;
    case "ioc":
      // Any indicator, whatever its type - the catch-all for "is this value
      // anywhere in our indicator set".
      return [...doc.ip, ...doc.domain, ...doc.url, ...doc.hash, ...doc.cve];
  }
}

function termMatches(doc: SearchDoc, field: Field, matcher: Matcher): boolean {
  return matchesAny(matcher, valuesFor(doc, field));
}

/**
 * The reports satisfying the query. Evaluated per document so `NOT` means "the
 * rest of the corpus" rather than "the rest of some intermediate result", which
 * is what makes `label:X NOT adv:Y` behave as written.
 */
export function evaluateQuery(
  node: QueryNode,
  corpus: readonly SearchDoc[],
): SearchDoc[] {
  return corpus.filter((doc) => matchesDoc(node, doc));
}

/** Whether one report satisfies the query. */
export function matchesDoc(node: QueryNode, doc: SearchDoc): boolean {
  switch (node.type) {
    case "term":
      return termMatches(doc, node.field, node.matcher);
    case "and":
      return node.children.every((c) => matchesDoc(c, doc));
    case "or":
      return node.children.some((c) => matchesDoc(c, doc));
    case "not":
      return !matchesDoc(node.child, doc);
  }
}

/** An intel_items row as the search needs it, kept for building the results. */
export type CorpusRow = {
  id: string;
  kind: string | null;
  title: string;
  url: string | null;
  description: string | null;
  source_name: string | null;
  published_at: string | null;
  raw_hash: string;
  cve_id: string | null;
  target: string | null;
  exploit_status: string | null;
  date_label: string | null;
  adversary_label: string | null;
  crowdstrike_adversary: string | null;
};

/** Build the searchable view of one report. Exported for tests. */
export function toDoc(
  row: CorpusRow,
  labels: string[],
  iocs: { type: string; value: string }[],
): SearchDoc {
  const doc: SearchDoc = {
    id: row.id,
    // The exploit fields join the free-text haystack so a bare keyword search
    // still finds a CVE or an affected product, as it did before.
    text: [row.title, row.description, row.cve_id, row.target].filter(
      (v): v is string => !!v,
    ),
    source: row.source_name,
    // Either spelling of the actor: the stored attribution and the feed's own.
    adversary: [row.adversary_label, row.crowdstrike_adversary].filter(
      (v): v is string => !!v,
    ),
    labels,
    ip: [],
    domain: [],
    url: [],
    hash: [],
    // An exploit item carries its CVE directly, not only as a linked indicator.
    cve: row.cve_id ? [row.cve_id] : [],
    ttp: [],
  };
  for (const { type, value } of iocs) {
    switch (type) {
      case "ip":
        doc.ip.push(value);
        break;
      case "domain":
        doc.domain.push(value);
        break;
      case "uri":
        doc.url.push(value);
        break;
      case "file_hash":
        doc.hash.push(value);
        break;
      case "cve":
        doc.cve.push(value);
        break;
      case "mitre":
        doc.ttp.push(value);
        break;
    }
  }
  return doc;
}
