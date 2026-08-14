// Reading a pile of pasted text as a list of indicators to look up.
//
// An analyst arrives with indicators in whatever shape they were given: a
// paragraph from an email, a column from a spreadsheet, a block of defanged
// values from someone else's report. Asking them to tidy that into one search
// box per value is the work this avoids - paste it, and every indicator in it
// is searched at once.
//
// The extraction is the same one that reads indicators out of a report, so a
// value pasted here matches a value stored from there by construction: both
// arrive through defanging and the same validity rules. Pure, so what counts as
// an indicator is tested without a database.

import {
  extractIndicators,
  normalizeIndicatorValue,
} from "./report-indicators";

/** The indicator types this searches. Ordered as the results are grouped. */
export const IOC_SEARCH_TYPES = ["ip", "domain", "file_hash"] as const;
export type IocSearchType = (typeof IOC_SEARCH_TYPES)[number];

export const IOC_TYPE_LABEL: Record<IocSearchType, string> = {
  ip: "IP address",
  domain: "Domain",
  file_hash: "File hash",
};

export type IocTerm = { value: string; type: IocSearchType };

/**
 * How many indicators one search will take.
 *
 * A whole report pasted in can carry hundreds, and each one becomes a section
 * of results nobody is going to read. The rest are reported as a count rather
 * than dropped quietly.
 */
export const MAX_IOC_TERMS = 60;

export type IocQuery = {
  terms: IocTerm[];
  /** Indicators found beyond the limit, so the box can say how many. */
  overflow: number;
};

/**
 * Every indicator in a block of text, deduplicated and in a stable order.
 *
 * Fanged or defanged makes no difference - hxxps://evil[.]com and evil.com are
 * the same domain and produce one term. CVEs and ATT&CK techniques are left
 * alone: this searches infrastructure and artefacts, and a CVE is better found
 * by the query language, where it can be combined with anything else.
 */
export function parseIocQuery(text: string): IocQuery {
  const found = extractIndicators(text ?? "");
  const byType: Record<IocSearchType, string[]> = {
    ip: found.ips,
    domain: found.domains,
    file_hash: found.files,
  };

  const seen = new Set<string>();
  const terms: IocTerm[] = [];
  let overflow = 0;
  // Grouped by type, in the order the types are listed: an analyst reading the
  // results should find the addresses together and the hashes together, not in
  // whatever order the paragraph happened to mention them.
  for (const type of IOC_SEARCH_TYPES) {
    for (const raw of byType[type]) {
      const value = normalizeIndicatorValue(raw, type);
      const key = `${type}\t${value.toLowerCase()}`;
      if (!value || seen.has(key)) continue;
      seen.add(key);
      if (terms.length >= MAX_IOC_TERMS) {
        overflow++;
        continue;
      }
      terms.push({ value, type });
    }
  }
  return { terms, overflow };
}
