// Find-in-report: turning what an analyst typed into a pattern that also
// matches how the report wrote it.
//
// Indicators appear defanged as often as not - 1.2.3[.]4, hxxp://evil[.]com,
// example[dot]org - because that is how you put one in a document without
// making it clickable. An analyst searching for the indicator types it the
// normal way, so a literal search finds nothing in exactly the reports that
// matter. Every match here is on both forms, in either direction.
//
// Pure, so the matching rules are testable without a browser.

import { normalizeIndicator } from "./report-indicators";

// How each character that gets defanged can appear in a report. The first
// alternative is always the plain form, so an already-plain document matches on
// the cheapest branch.
const DOT = "(?:\\.|\\[\\.\\]|\\(\\.\\)|\\{\\.\\}|\\[dot\\]|\\(dot\\))";
const COLON = "(?::|\\[:\\])";
const SLASH = "(?:/|\\[/\\])";
const AT = "(?:@|\\[@\\]|\\[at\\]|\\(at\\))";
// The whole scheme separator is often wrapped as one unit: hxxp[://]evil.com.
const SCHEME_SEP = `(?:${COLON}${SLASH}${SLASH}|\\[://\\])`;
// hxxp and hxxps both start here; the trailing s is an ordinary character.
const HTTP = "(?:h(?:tt|xx)p)";

function escapeLiteral(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A pattern matching `query` however the report fanged it, case-insensitively.
 *
 * The query is refanged first, so it does not matter which form the analyst
 * typed or pasted - searching `1.2.3[.]4` and `1.2.3.4` are the same search.
 *
 * Returns null for a query with nothing in it to match.
 */
export function searchPattern(query: string): RegExp | null {
  // normalizeIndicator covers the notations that appear in stored indicators;
  // an address the analyst pasted may also have had its @ broken.
  const wanted = normalizeIndicator(query ?? "").replace(
    /\[@\]|\[at\]|\(at\)/gi,
    "@",
  );
  if (!wanted) return null;

  let out = "";
  let i = 0;
  while (i < wanted.length) {
    const rest = wanted.slice(i);
    if (/^:\/\//.test(rest)) {
      out += SCHEME_SEP;
      i += 3;
    } else if (/^http/i.test(rest)) {
      out += HTTP;
      i += 4;
    } else if (/^\s+/.test(rest)) {
      // Any whitespace matches any whitespace: the reading view rewraps
      // paragraphs, so a phrase can straddle a line break that was not there
      // when the analyst copied it.
      out += "\\s+";
      i += /^\s+/.exec(rest)![0].length;
    } else {
      const char = wanted[i];
      out +=
        char === "."
          ? DOT
          : char === ":"
            ? COLON
            : char === "/"
              ? SLASH
              : char === "@"
                ? AT
                : escapeLiteral(char);
      i += 1;
    }
  }

  try {
    return new RegExp(out, "gi");
  } catch {
    return null;
  }
}

export type MatchRange = { start: number; end: number };

/** Every match of `query` in `text`, in order. Empty when there is no query. */
export function matchRanges(text: string, query: string): MatchRange[] {
  const pattern = searchPattern(query);
  if (!pattern || !text) return [];
  const ranges: MatchRange[] = [];
  let m: RegExpExecArray | null;
  pattern.lastIndex = 0;
  while ((m = pattern.exec(text)) !== null) {
    // A pattern that can match nothing would spin forever.
    if (m[0].length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }
  return ranges;
}

/** A run of text, and whether it is one of the matches. */
export type Segment = { text: string; hit: boolean };

/**
 * Split `text` into alternating plain and matching runs, in order.
 *
 * The renderer walks these to wrap the matches, so this is where the hit
 * numbering comes from: the nth `hit: true` segment across the document is
 * the nth hit a reader scrolling from the top would reach.
 */
export function splitOnMatches(text: string, query: string): Segment[] {
  const ranges = matchRanges(text, query);
  if (!ranges.length) return text ? [{ text, hit: false }] : [];
  const out: Segment[] = [];
  let last = 0;
  for (const r of ranges) {
    if (r.start > last) out.push({ text: text.slice(last, r.start), hit: false });
    out.push({ text: text.slice(r.start, r.end), hit: true });
    last = r.end;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out;
}

/** Step to the next or previous hit, wrapping at either end. */
export function stepHit(active: number, total: number, delta: number): number {
  if (total <= 0) return 0;
  return (((active + delta) % total) + total) % total;
}
