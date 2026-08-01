// Turn a fetched page into a clean reading view: the article block, converted to
// markdown, with site chrome and advertising removed and the real illustrations
// kept. Pure (no network, no server imports) so it is unit-tested directly.
//
// Regex-based rather than DOM-based on purpose: this runs server-side on pages
// we do not control, and the existing scrape helpers already work this way, so
// it adds no dependency and no parser to keep in step.

function textLength(fragment: string): number {
  return fragment
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

/**
 * The element most likely to hold the article. Sites often carry several
 * <article> blocks that are teaser or promo cards, so the richest candidate wins
 * rather than the first one found.
 */
export function articleScope(html: string): string {
  const candidates = [
    ...(html.match(/<article\b[\s\S]*?<\/article>/gi) ?? []),
    ...(html.match(/<main\b[\s\S]*?<\/main>/gi) ?? []),
  ];
  let best = "";
  let bestLen = 0;
  for (const c of candidates) {
    const len = textLength(c);
    if (len > bestLen) {
      best = c;
      bestLen = len;
    }
  }
  if (bestLen > 0) return best;
  return html.match(/<body\b[\s\S]*?<\/body>/i)?.[0] ?? html;
}

// Wrappers whose contents are never article body: scripts and styling, embedded
// widgets, interactive controls, and the surrounding site furniture.
const DROP_ELEMENTS =
  /<(script|style|noscript|iframe|svg|form|button|select|textarea|canvas|template|video|audio|nav|aside|footer|header)\b[\s\S]*?<\/\1>/gi;

// Containers a publisher marks as advertising, promotion or recirculation. Kept
// deliberately narrow: it matches whole words in class/id, so an article about
// "adversaries" or a "download" section is not swallowed.
const AD_WORDS =
  "ad|ads|advert|advertisement|sponsor|sponsored|promo|promotion|newsletter|subscribe|signup|related|recirc|recommended|trending|share|social|comment|comments|cookie|consent|paywall|popup|modal|breadcrumb|byline-social|taboola|outbrain|" +
  // Site furniture that sits inside the article element on many publishers:
  // the masthead, the author box, "expert insights" rails and tag lists.
  "logo|masthead|branding|menu|sidebar|widget|author|byline|bio|profile|expert|popular|footer|toolbar|entry-meta|post-meta|tags";
const AD_CONTAINER = new RegExp(
  `<(div|section|aside|ul|figure|span)\\b[^>]*(?:class|id|data-testid)\\s*=\\s*"[^"]*\\b(?:${AD_WORDS})\\b[^"]*"[\\s\\S]*?<\\/\\1>`,
  "gi",
);

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
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? (m[2] ?? m[3] ?? "").trim() : null;
}

function absolute(url: string, baseUrl: string): string | null {
  try {
    const u = new URL(url, baseUrl);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// Below this, an image is furniture: an icon, avatar, spacer or tracking pixel.
const MIN_IMAGE_PX = 150;

// An image the site labels as chrome. Author headshots and mastheads carry no
// useful dimensions on many templates, so the class is the reliable signal.
const IMAGE_CHROME =
  /\b(?:avatar|gravatar|logo|icon|thumb|thumbnail|emoji|profile|headshot|badge|pixel|spacer|placeholder)\b/;

/**
 * Whether an <img> is a real illustration rather than advertising or chrome.
 * Publishers leave a lot behind: lazy-load placeholders with no src, template
 * strings a script fills in later, tracking pixels, and banner slots.
 */
export function isContentImage(tag: string, baseUrl: string): boolean {
  const raw =
    attr(tag, "src") ||
    // Lazy-loaded images keep the real URL out of src until scripted in.
    attr(tag, "data-src") ||
    attr(tag, "data-original") ||
    "";
  if (!raw) return false;
  // Unfilled template placeholders, e.g. src="${pick.i}" or "{{image}}".
  if (/[${}]|^\s*$/.test(raw)) return false;
  const src = absolute(raw, baseUrl);
  if (!src) return false;
  if (/^data:/i.test(raw)) return false;

  const alt = (attr(tag, "alt") ?? "").toLowerCase();
  if (new RegExp(`\\b(?:${AD_WORDS})\\b`).test(alt)) return false;
  if (new RegExp(`\\b(?:${AD_WORDS})\\b`).test(src.toLowerCase())) return false;
  const cls = (attr(tag, "class") ?? "").toLowerCase();
  if (IMAGE_CHROME.test(cls) || IMAGE_CHROME.test(alt)) return false;

  // Explicit dimensions are the most reliable signal for icons and pixels.
  const w = Number(attr(tag, "width") ?? "");
  const h = Number(attr(tag, "height") ?? "");
  if (w && w < MIN_IMAGE_PX) return false;
  if (h && h < MIN_IMAGE_PX) return false;
  return true;
}

function imageMarkdown(tag: string, baseUrl: string): string {
  const raw =
    attr(tag, "src") || attr(tag, "data-src") || attr(tag, "data-original") || "";
  const src = absolute(raw, baseUrl);
  if (!src) return "";
  const alt = decodeEntities(attr(tag, "alt") ?? "").replace(/[[\]]/g, "");
  return `\n\n![${alt}](${src})\n\n`;
}

/**
 * Convert a page to the markdown the reading view renders: headings, paragraphs,
 * lists, quotes, code, links and the article's own images. Everything else -
 * scripts, widgets, navigation, advertising - is dropped.
 */
export function htmlToArticleMarkdown(html: string, baseUrl: string): string {
  let s = articleScope(html);

  // 1. Remove whole elements that never contain article prose, then the
  //    publisher's advertising and recirculation blocks. Twice, because these
  //    containers nest and a non-greedy match only unwraps one level per pass.
  s = s.replace(DROP_ELEMENTS, " ");
  s = s.replace(AD_CONTAINER, " ").replace(AD_CONTAINER, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");

  // 2. Images: keep the real ones, drop the rest.
  s = s.replace(/<img\b[^>]*>/gi, (tag) =>
    isContentImage(tag, baseUrl) ? imageMarkdown(tag, baseUrl) : " ",
  );

  // 3. Block structure to markdown.
  s = s
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, lvl: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return text ? `\n\n${"#".repeat(Number(lvl))} ${text}\n\n` : "\n\n";
    })
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<blockquote\b[^>]*>/gi, "\n\n> ")
    .replace(/<\/blockquote>/gi, "\n\n")
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner: string) => {
      const code = decodeEntities(inner.replace(/<[^>]+>/g, "")).trim();
      return code ? `\n\n\`\`\`\n${code}\n\`\`\`\n\n` : "\n\n";
    })
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, inner: string) => {
      const code = decodeEntities(inner.replace(/<[^>]+>/g, "")).trim();
      return code ? ` \`${code}\` ` : " ";
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|tr|figcaption|figure)>/gi, "\n\n");

  // 4. Links, keeping only real destinations and dropping empty anchors.
  s = s.replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
    (_, attrs: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      // Images survived step 2 as markdown, so an anchor may now contain one.
      // Nesting it as [![alt](src)](href) leaves stray brackets once the image
      // is rendered, so the label and the image are separated: an anchor that
      // is only an image ("click the photo") yields the illustration alone,
      // while an icon beside link text ("Share", "Read now") is dropped.
      const images = text.match(/!\[[^\]]*\]\([^)]*\)/g) ?? [];
      const label = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim();
      if (!label) return images.length ? `\n\n${images.join(" ")}\n\n` : " ";
      const href = attr(`<a ${attrs}>`, "href");
      const abs = href ? absolute(href, baseUrl) : null;
      return abs ? `[${label}](${abs})` : label;
    },
  );

  // 5. Whatever markup is left is decoration; drop it and tidy the whitespace.
  s = decodeEntities(s.replace(/<[^>]+>/g, " "));
  return s
    .replace(/[ \t\u00a0]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^(?:-\s*\n)+/gm, "")
    .trim();
}

/**
 * Flatten images nested inside links. Reader proxies emit both shapes, and the
 * renderer draws the inner image first, leaving the surrounding brackets and URL
 * as literal text. `[![alt](src)](href)` is "click the photo", so the
 * illustration is kept; `[Share ![icon](src)](href)` is a share or read-more
 * control, so the icon goes and the link's own text stays.
 */
export function unwrapLinkedImages(md: string): string {
  const IMAGE = "!\\[[^\\]]*\\]\\([^)]*\\)";
  return md
    .replace(new RegExp(`\\[(${IMAGE})\\]\\([^)]*\\)`, "g"), "$1")
    .replace(
      new RegExp(`\\[([^[\\]]*)${IMAGE}([^[\\]]*)\\]\\(([^)]*)\\)`, "g"),
      (_, before: string, after: string, href: string) => {
        const text = `${before}${after}`.trim();
        return text ? `[${text}](${href})` : "";
      },
    );
}

/**
 * Drop markdown link and image targets, keeping the visible text. Reader-
 * recovered bodies arrive as markdown, so without this the site's own asset and
 * navigation URLs would be scraped as URI indicators.
 */
export function plainFromMarkdown(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[ \t]+/g, " ");
}
