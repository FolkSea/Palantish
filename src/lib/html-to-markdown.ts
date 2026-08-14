// Turn copied web content into the Markdown the report renderer reads.
//
// Copying an article out of a browser puts two things on the clipboard: the
// plain text, and the HTML the page was made of. A textarea takes the first,
// which is why pasting an article used to lose every image, link and heading in
// it. This reads the second.
//
// It is a tokeniser, not a parser: clipboard HTML is serialised from a live DOM
// and arrives well formed, and the alternative in a browser (DOMParser) cannot
// run in a unit test. Anything not in the tag list below has its markup dropped
// and its text kept, so an unrecognised wrapper costs formatting, never words.
//
// Nothing here trusts the input. The output is Markdown - text - and it reaches
// the reader through the same renderer as any other report body, which builds
// React elements and accepts only http(s) URLs. There is no HTML path.

/** An image the paste could not carry across, so the UI can say why. */
export type DroppedImage = { reason: "not_on_the_web"; alt: string };

export type HtmlToMarkdown = {
  markdown: string;
  /** Images left out: screenshots and inlined data, which have no URL. */
  dropped: DroppedImage[];
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "-",
  ndash: "-",
  hellip: "...",
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
};

/** Decode the entities a browser puts in copied HTML. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** Read one tag's attributes. Values may be single-, double- or unquoted. */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag)) !== null) {
    out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? "");
  }
  return out;
}

/**
 * Absolute form of a URL found in copied markup.
 *
 * Copied HTML is full of relative links - the page they came from resolved
 * them, and once the markup is somewhere else nothing does. `base` is the
 * report's own URL, which is exactly what the browser would have resolved
 * against. Returns null for anything that is not http(s) once resolved.
 */
export function absoluteUrl(value: string, base?: string | null): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  try {
    const u = base ? new URL(raw, base) : new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

// Markup that carries no text worth keeping, dropped whole rather than emptied.
const DISCARD = /<(script|style|head|noscript|svg|iframe|form|select)\b[^>]*>[\s\S]*?<\/\1>/gi;

/**
 * Convert copied HTML into Markdown.
 *
 * `base` is the article's URL, used to resolve relative image and link targets.
 */
export function htmlToMarkdown(html: string, base?: string | null): HtmlToMarkdown {
  const dropped: DroppedImage[] = [];
  let out = "";
  // Depth of the ordered/unordered list stack, so an item knows its marker.
  const listStack: ("ul" | "ol")[] = [];
  const counters: number[] = [];
  let inPre = false;
  // The href of the anchor currently open, needed again at its closing tag.
  let pendingHref = "";

  const src = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(DISCARD, "")
    // A self-closed or unclosed one of these still has to go.
    .replace(/<(script|style|svg)\b[^>]*\/?>/gi, "");

  const emit = (s: string) => {
    out += s;
  };
  // Collapse to at most one blank line: copied markup is full of empty wrappers.
  const block = () => {
    if (!out.endsWith("\n\n")) emit(out.endsWith("\n") ? "\n" : "\n\n");
  };

  const TOKEN = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(src)) !== null) {
    // The text between the previous tag and this one.
    const text = src.slice(last, m.index);
    if (text) emit(inPre ? decodeEntities(text) : inlineText(text));
    last = TOKEN.lastIndex;

    const tag = m[0];
    const name = m[1].toLowerCase();
    const closing = tag.startsWith("</");

    switch (name) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        block();
        if (!closing) emit(`${"#".repeat(Number(name[1]))} `);
        break;
      }
      case "p":
      case "div":
      case "section":
      case "article":
      case "header":
      case "footer":
      case "tr":
        block();
        break;
      case "br":
        emit("\n");
        break;
      case "hr":
        block();
        emit("---");
        block();
        break;
      case "ul":
      case "ol":
        if (closing) {
          listStack.pop();
          counters.pop();
          block();
        } else {
          block();
          listStack.push(name);
          counters.push(0);
        }
        break;
      case "li": {
        if (closing) break;
        if (!out.endsWith("\n")) emit("\n");
        const depth = Math.max(0, listStack.length - 1);
        const ordered = listStack[depth] === "ol";
        if (ordered) counters[depth] = (counters[depth] ?? 0) + 1;
        emit(`${"  ".repeat(depth)}${ordered ? `${counters[depth]}.` : "-"} `);
        break;
      }
      case "blockquote":
        block();
        if (!closing) emit("> ");
        break;
      case "pre":
        inPre = !closing;
        block();
        emit("```");
        block();
        break;
      case "code":
        if (!inPre) emit("`");
        break;
      case "strong":
      case "b":
        emit("**");
        break;
      case "em":
      case "i":
        emit("*");
        break;
      case "img": {
        if (closing) break;
        const a = attrs(tag);
        const alt = (a.alt ?? "").replace(/[[\]\n]/g, " ").trim();
        const url = absoluteUrl(a.src || a["data-src"] || "", base);
        // A screenshot, or an image the page inlined: there is no address to
        // store, and the row is not the place to put a megabyte of base64.
        if (!url) dropped.push({ reason: "not_on_the_web", alt });
        else emit(`\n\n![${alt}](${url})\n\n`);
        break;
      }
      case "a": {
        if (closing) {
          // Only close what was opened: a link with no usable target got no
          // bracket, and emitting one here would leave "]" adrift in the text.
          if (pendingHref) emit(`](${pendingHref})`);
          pendingHref = "";
          break;
        }
        pendingHref = absoluteUrl(attrs(tag).href ?? "", base) ?? "";
        if (pendingHref) emit("[");
        break;
      }
      default:
        break; // markup dropped, text kept
    }
  }
  const tail = src.slice(last);
  if (tail) emit(inlineText(tail));

  return { markdown: tidy(out), dropped };
}


/** Text between tags: entities decoded, runs of whitespace collapsed. */
function inlineText(s: string): string {
  return decodeEntities(s).replace(/\s+/g, " ");
}

/** Trim, drop the empty markers copied markup leaves, and cap blank lines. */
function tidy(s: string): string {
  return s
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    // A heading or list marker with nothing after it, from an empty wrapper.
    .replace(/^[ \t]*(?:#{1,6}|[-*]|\d+\.|>)[ \t]*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .trim();
}

/**
 * Whether copied HTML is worth converting.
 *
 * Copying inside a plain-text field still puts a scrap of HTML on the
 * clipboard; converting that would only add noise, so the paste falls through
 * to the browser's own handling unless the markup actually carries structure.
 */
export function worthConverting(html: string): boolean {
  return /<(img|a|h[1-6]|ul|ol|li|p|blockquote|pre|table)\b/i.test(html ?? "");
}
