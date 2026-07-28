// Convert arbitrary feed / model text to plain ASCII: decode HTML entities,
// transliterate common Unicode punctuation, drop anything else. The dashboard
// is plain-text only, and RSS content is full of entities (&#8211;, &#8217;,
// &amp;) and smart punctuation. This file is kept ASCII-only (enforced by
// pnpm ascii-check) by building the punctuation map from numeric code points.

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "...",
  mdash: "--",
  ndash: "-",
  ldquo: '"',
  rdquo: '"',
  lsquo: "'",
  rsquo: "'",
  laquo: '"',
  raquo: '"',
  bull: "-",
  middot: "-",
  copy: "(c)",
  reg: "(R)",
  trade: "(TM)",
  deg: " deg",
  euro: "EUR",
  pound: "GBP",
  cent: "c",
  times: "x",
};

// Common non-ASCII punctuation code points -> ASCII replacement.
const PUNCT = new Map<string, string>();
const mapPunct = (codes: number[], repl: string) => {
  for (const c of codes) PUNCT.set(String.fromCharCode(c), repl);
};
mapPunct([0x2010, 0x2011, 0x2012, 0x2013, 0x2212], "-"); // hyphens, en dash, minus
mapPunct([0x2014, 0x2015], "--"); // em dash, horizontal bar
mapPunct([0x2018, 0x2019, 0x201a, 0x201b, 0x2032], "'"); // single quotes, prime
mapPunct([0x201c, 0x201d, 0x201e, 0x201f, 0x2033, 0x00ab, 0x00bb], '"'); // double quotes
mapPunct([0x2026], "..."); // ellipsis
mapPunct([0x00a0, 0x2007, 0x202f], " "); // non-breaking / figure spaces
mapPunct([0x2022, 0x00b7, 0x2027], "-"); // bullet, middle dot
mapPunct([0x00ad, 0x200b, 0x200c, 0x200d, 0xfeff], ""); // soft hyphen / zero-width
mapPunct([0x2122], "(TM)");
mapPunct([0x00a9], "(c)");
mapPunct([0x00ae], "(R)");
mapPunct([0x20ac], "EUR");
mapPunct([0x00a3], "GBP");
mapPunct([0x2192], "->");
mapPunct([0x2190], "<-");
mapPunct([0x2194], "<->");

function codePoint(n: number): string {
  return Number.isFinite(n) && n > 0 && n <= 0x10ffff
    ? String.fromCodePoint(n)
    : "";
}

function decodeEntities(input: string): string {
  return input
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_m, h) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => codePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) =>
      name in NAMED ? NAMED[name] : m,
    );
}

/**
 * Sanitize text to plain ASCII. `keepNewlines` preserves paragraph breaks
 * (used for the executive summary); the default collapses all whitespace.
 */
export function toAscii(
  input: string | null | undefined,
  keepNewlines = false,
): string {
  if (!input) return "";

  let s = decodeEntities(input);
  // Second pass catches double-encoded entities (e.g. &amp;#8211;).
  if (/&#|&[a-zA-Z]+;/.test(s)) s = decodeEntities(s);

  s = s.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, (ch) => {
    const mapped = PUNCT.get(ch);
    if (mapped !== undefined) return mapped;
    // Accented Latin letters decompose to a base ASCII letter (e.g. e-acute ->
    // e); drop the combining diacritical marks (U+0300-U+036F) numerically.
    const base = [...ch.normalize("NFKD")]
      .filter((c) => {
        const cp = c.codePointAt(0) ?? 0;
        return cp < 0x0300 || cp > 0x036f;
      })
      .join("");
    return /^[\x20-\x7E]*$/.test(base) ? base : "";
  });

  if (keepNewlines) {
    s = s
      .replace(/[^\S\n]+/g, " ") // collapse horizontal whitespace, keep \n
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]*\n[ \t]*/g, "\n");
  } else {
    s = s.replace(/\s+/g, " ");
  }
  return s.trim();
}
