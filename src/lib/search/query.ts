// The dashboard's search query language: field terms, boolean logic and regex.
//
//   label:Malware/FlyingEagle AND adv:"FANCY BEAR"
//   (ip:192.168 OR dom:~evil\.(ru|su)) NOT label:AI/Claude
//   zimbra ttp:T1059 -src:Reddit
//
// Parsing is pure so the grammar is unit-tested directly; evaluation happens in
// evaluate.ts against whatever corpus the caller loaded.

import { normalizeIndicator } from "@/lib/report-indicators";

/** A searchable attribute of a report. `text` is the default for bare words. */
export type Field =
  | "text"
  | "label"
  | "adversary"
  | "ttp"
  | "cve"
  | "ip"
  | "domain"
  | "url"
  | "hash"
  | "ioc"
  | "source";

/**
 * Field names as typed, mapped to the attribute they search. Several spellings
 * per field: analysts write `adv:`, `adversary:` and `actor:` interchangeably,
 * and an unrecognised prefix stays literal text so `https://evil.com` and
 * `ratio:3` still search as keywords.
 */
export const FIELD_ALIASES: Record<string, Field> = {
  text: "text",
  keyword: "text",
  label: "label",
  tag: "label",
  adv: "adversary",
  adversary: "adversary",
  actor: "adversary",
  ttp: "ttp",
  mitre: "ttp",
  technique: "ttp",
  cve: "cve",
  ip: "ip",
  dom: "domain",
  domain: "domain",
  url: "url",
  uri: "url",
  hash: "hash",
  filehash: "hash",
  file: "hash",
  ioc: "ioc",
  indicator: "ioc",
  src: "source",
  source: "source",
};

/** Indicator fields: their values are stored fanged, so a defanged query for
 * `evil[.]com` has to normalise to `evil.com` before it can match. */
const INDICATOR_FIELDS = new Set<Field>([
  "ip",
  "domain",
  "url",
  "hash",
  "cve",
  "ioc",
]);

/** `:` matches a case-insensitive substring, or a wildcard pattern when the
 * value contains `*`; `:~` matches a regular expression. */
export type Matcher =
  | { kind: "contains"; value: string }
  // A ":" value containing "*", anchored at both ends: Malware/* is everything
  // under that branch, *bear is anything ending in it.
  | { kind: "glob"; source: string; re: RegExp }
  | { kind: "regex"; source: string; re: RegExp };

export type QueryNode =
  | { type: "term"; field: Field; matcher: Matcher }
  | { type: "and"; children: QueryNode[] }
  | { type: "or"; children: QueryNode[] }
  | { type: "not"; child: QueryNode };

export type ParseResult =
  | { ok: true; node: QueryNode }
  | { ok: false; error: string };

// A user-supplied pattern is compiled and run server-side, so keep it short
// enough that a pathological one cannot spend long backtracking.
const MAX_REGEX_LENGTH = 200;
// Each "*" becomes a ".*", and a long chain of them is the one way a glob can
// backtrack badly. Far more than any real query needs.
const MAX_WILDCARDS = 10;

/* --- Tokenizer -------------------------------------------------------------- */

type Token =
  | { t: "term"; field: Field; op: ":" | ":~"; value: string }
  | { t: "and" }
  | { t: "or" }
  | { t: "not" }
  | { t: "(" }
  | { t: ")" };

const FIELD_PREFIX = /^([A-Za-z_]+):(~?)/;
const WORD_END = /[\s()]/;

class ParseError extends Error {}

/** Read a double-quoted value, so a term can hold spaces: label:"Target/F5 BIG-IP". */
function readQuoted(s: string, from: number): { value: string; next: number } {
  let i = from + 1;
  let out = "";
  while (i < s.length && s[i] !== '"') {
    // Backslash escapes the next character, so a quote can appear in a value.
    if (s[i] === "\\" && i + 1 < s.length) {
      out += s[i + 1];
      i += 2;
      continue;
    }
    out += s[i];
    i += 1;
  }
  if (i >= s.length) throw new ParseError("Unclosed quote in the query.");
  return { value: out, next: i + 1 };
}

function readBare(s: string, from: number): { value: string; next: number } {
  let i = from;
  while (i < s.length && !WORD_END.test(s[i])) i += 1;
  return { value: s.slice(from, i), next: i };
}

/**
 * Read an unquoted regular expression. Brackets belong to the pattern far more
 * often than they group a query, so the read follows the regex's own nesting -
 * groups and character classes are consumed - and stops only at whitespace or a
 * ")" that has nothing open to close, which must be the query's own bracket.
 */
function readRegexValue(s: string, from: number): { value: string; next: number } {
  let i = from;
  let depth = 0;
  let inClass = false;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) break;
    if (c === "\\" && i + 1 < s.length) {
      i += 2;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      i += 1;
      continue;
    }
    if (c === "[") {
      inClass = true;
    } else if (c === "(") {
      depth += 1;
    } else if (c === ")") {
      if (depth === 0) break;
      depth -= 1;
    }
    i += 1;
  }
  return { value: s.slice(from, i), next: i };
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === "(" || c === ")") {
      tokens.push({ t: c });
      i += 1;
      continue;
    }
    // Prefix negation, but only against something: a bare "-" is punctuation,
    // and a hyphen inside a value (CVE-2026-1234) is never at the start.
    if ((c === "-" || c === "!") && i + 1 < input.length && !/[\s()]/.test(input[i + 1])) {
      tokens.push({ t: "not" });
      i += 1;
      continue;
    }
    if (c === "&" && input[i + 1] === "&") {
      tokens.push({ t: "and" });
      i += 2;
      continue;
    }
    if (c === "|" && input[i + 1] === "|") {
      tokens.push({ t: "or" });
      i += 2;
      continue;
    }

    // An optional field prefix, then the value it applies to.
    let field: Field | null = null;
    let op: ":" | ":~" = ":";
    const m = FIELD_PREFIX.exec(input.slice(i));
    if (m) {
      const resolved = FIELD_ALIASES[m[1].toLowerCase()];
      if (resolved) {
        field = resolved;
        op = m[2] ? ":~" : ":";
        i += m[0].length;
      }
    }

    const read =
      input[i] === '"'
        ? readQuoted(input, i)
        : op === ":~"
          ? readRegexValue(input, i)
          : readBare(input, i);
    i = read.next;
    const value = read.value;

    if (field === null) {
      const word = value.toUpperCase();
      if (word === "AND") {
        tokens.push({ t: "and" });
        continue;
      }
      if (word === "OR") {
        tokens.push({ t: "or" });
        continue;
      }
      if (word === "NOT") {
        tokens.push({ t: "not" });
        continue;
      }
    }
    // "label:" with nothing after it is a typo, not a search for everything.
    if (!value) {
      if (field === null) continue;
      throw new ParseError(`"${m?.[0] ?? ""}" needs a value.`);
    }
    tokens.push({ t: "term", field: field ?? "text", op, value });
  }
  return tokens;
}

/* --- Parser ----------------------------------------------------------------- */

function buildMatcher(field: Field, op: ":" | ":~", value: string): Matcher {
  if (op === ":~") {
    if (value.length > MAX_REGEX_LENGTH) {
      throw new ParseError(
        `Regular expressions are limited to ${MAX_REGEX_LENGTH} characters.`,
      );
    }
    try {
      // Case-insensitive to match how ":" behaves; indicators are not
      // case-significant and analysts do not expect to have to think about it.
      return { kind: "regex", source: value, re: new RegExp(value, "i") };
    } catch {
      throw new ParseError(`"${value}" is not a valid regular expression.`);
    }
  }
  // Defanged indicators (evil[.]com, hxxp://) resolve to their stored form.
  const needle = INDICATOR_FIELDS.has(field) ? normalizeIndicator(value) : value;
  if (needle.includes("*")) {
    const stars = needle.split("*").length - 1;
    if (stars > MAX_WILDCARDS) {
      throw new ParseError(`Use at most ${MAX_WILDCARDS} wildcards in one term.`);
    }
    return { kind: "glob", source: needle, re: globToRegExp(needle) };
  }
  return { kind: "contains", value: needle.toLowerCase() };
}

/**
 * Compile a wildcard value. Anchored at both ends, so "*" is the only thing that
 * spans - `Malware/*` is that branch and nothing else, where an unanchored match
 * would also hit "NotMalware/x". Everything but "*" is literal, so a value full
 * of dots and slashes cannot accidentally behave like a regular expression.
 *
 * To match a literal asterisk, use `:~` and escape it there.
 */
function globToRegExp(glob: string): RegExp {
  const body = glob
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}$`, "i");
}

/**
 * Recursive descent over `or -> and -> unary -> primary`. Adjacent terms are
 * an implicit AND, so `zimbra label:Malware` reads the way it looks.
 */
class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  parse(): QueryNode {
    const node = this.parseOr();
    if (this.pos < this.tokens.length) {
      throw new ParseError("Unbalanced closing bracket in the query.");
    }
    return node;
  }

  private parseOr(): QueryNode {
    const children = [this.parseAnd()];
    while (this.peek()?.t === "or") {
      this.pos += 1;
      children.push(this.parseAnd());
    }
    return children.length === 1 ? children[0] : { type: "or", children };
  }

  private parseAnd(): QueryNode {
    const children = [this.parseUnary()];
    for (;;) {
      const next = this.peek();
      if (!next || next.t === "or" || next.t === ")") break;
      if (next.t === "and") {
        this.pos += 1;
        children.push(this.parseUnary());
        continue;
      }
      // Implicit AND between adjacent terms.
      children.push(this.parseUnary());
    }
    return children.length === 1 ? children[0] : { type: "and", children };
  }

  private parseUnary(): QueryNode {
    if (this.peek()?.t === "not") {
      this.pos += 1;
      return { type: "not", child: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): QueryNode {
    const token = this.peek();
    if (!token) throw new ParseError("The query ends with an operator.");
    if (token.t === "(") {
      this.pos += 1;
      const inner = this.parseOr();
      if (this.peek()?.t !== ")") throw new ParseError("Unclosed bracket in the query.");
      this.pos += 1;
      return inner;
    }
    if (token.t === "term") {
      this.pos += 1;
      return {
        type: "term",
        field: token.field,
        matcher: buildMatcher(token.field, token.op, token.value),
      };
    }
    throw new ParseError(`Unexpected "${token.t.toUpperCase()}" in the query.`);
  }
}

/**
 * Parse a search query. Returns an error rather than throwing so the search box
 * can show what is wrong with what was typed. An empty query yields an error
 * too - the caller decides whether that means "show nothing" or "show all".
 */
export function parseQuery(input: string): ParseResult {
  try {
    const tokens = tokenize(input ?? "");
    if (tokens.length === 0) return { ok: false, error: "Enter something to search for." };
    return { ok: true, node: new Parser(tokens).parse() };
  } catch (err) {
    if (err instanceof ParseError) return { ok: false, error: err.message };
    return { ok: false, error: "That query could not be read." };
  }
}

/* --- Introspection ---------------------------------------------------------- */

/** Every field the query touches, so the caller loads only the data it needs. */
export function fieldsUsed(node: QueryNode): Set<Field> {
  const out = new Set<Field>();
  const walk = (n: QueryNode) => {
    if (n.type === "term") out.add(n.field);
    else if (n.type === "not") walk(n.child);
    else n.children.forEach(walk);
  };
  walk(node);
  return out;
}

/** Whether a value satisfies a matcher. Substring matching is case-insensitive. */
export function matcherMatches(matcher: Matcher, value: string): boolean {
  if (matcher.kind === "regex" || matcher.kind === "glob") {
    return matcher.re.test(value);
  }
  return value.toLowerCase().includes(matcher.value);
}

/** Whether any of a report's values for a field satisfies the matcher. */
export function matchesAny(
  matcher: Matcher,
  values: readonly (string | null | undefined)[],
): boolean {
  for (const v of values) {
    if (v && matcherMatches(matcher, v)) return true;
  }
  return false;
}
