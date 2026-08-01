import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { toAscii } from "@/lib/text";
import { serverEnv } from "@/lib/env";

export type ScrapedArticle = {
  title: string;
  description: string | null;
  publishedAt: Date | null;
  finalUrl: string;
  siteName: string;
  domain: string;
};

const FETCH_TIMEOUT_MS = 20000;
// Present as a normal desktop browser so sites that vary output (or block bots)
// return the same HTML a person clicking the link would see.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
};
const AI_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

/** Reject non-http(s) URLs and obvious internal/loopback hosts (basic SSRF guard). */
export function assertPublicHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("That does not look like a valid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs can be imported.");
  }
  const host = u.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (blocked) throw new Error("That host is not allowed.");
  return u;
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? m[1] : null;
}

/** First <meta> whose property/name matches one of `keys`, returning its content. */
function metaContent(html: string, keys: string[]): string | null {
  const wanted = keys.map((k) => k.toLowerCase());
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const key = (attr(tag, "property") ?? attr(tag, "name") ?? "").toLowerCase();
    if (wanted.includes(key)) {
      const content = attr(tag, "content");
      if (content && content.trim()) return content.trim();
    }
  }
  return null;
}

function tagText(html: string, tag: string): string | null {
  const m = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return null;
  const text = toAscii(m[1].replace(/<[^>]*>/g, " ")).trim();
  return text || null;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t);
}

function metaPublished(html: string): Date | null {
  return parseDate(
    metaContent(html, [
      "article:published_time",
      "article:published",
      "og:article:published_time",
      "datepublished",
      "date",
      "dc.date",
      "dc.date.issued",
      "parsely-pub-date",
      "sailthru.date",
    ]) ?? attr(html.match(/<time\b[^>]*>/i)?.[0] ?? "", "datetime"),
  );
}

/** Rough visible-text length of an HTML fragment, for comparing candidates. */
function textLength(fragment: string): number {
  return fragment
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

/**
 * The element most likely to hold the article. Sites often carry several
 * <article> blocks that are teaser or promo cards - The Hacker News has five,
 * none longer than 156 characters, with the real story in <main> - so the
 * richest candidate wins rather than the first one found.
 */
function contentScope(html: string): string {
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

/** Main body text of the page, tag-stripped. */
function bodyExcerpt(html: string): string | null {
  const scope = contentScope(html);
  const stripped = scope
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const text = toAscii(stripped).replace(/\s+/g, " ").trim();
  return text || null;
}

type FetchedPage = {
  html: string;
  finalUrl: string;
  domain: string;
  siteName: string;
  frameable: boolean;
};

/**
 * Decide, from a response's framing headers, whether a different origin (this
 * app) is allowed to embed the page in an iframe. Conservative: anything other
 * than "no restriction" or an explicit wildcard is treated as blocked, so the
 * caller falls back to scraped text rather than showing a blank frame.
 */
function computeFrameable(res: Response): boolean {
  const xfo = (res.headers.get("x-frame-options") ?? "").toLowerCase();
  if (xfo.includes("deny") || xfo.includes("sameorigin")) return false;
  const csp = (res.headers.get("content-security-policy") ?? "").toLowerCase();
  const m = csp.match(/frame-ancestors([^;]*)/);
  if (m && !/\*/.test(m[1])) return false;
  return true;
}

/** Fetch a URL and return its HTML plus derived site identity. Throws on any
 * network / status / content-type problem so callers can offer a fallback. */
async function fetchPage(rawUrl: string): Promise<FetchedPage> {
  const target = assertPublicHttpUrl(rawUrl.trim());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(target, {
      redirect: "follow",
      signal: controller.signal,
      headers: BROWSER_HEADERS,
    });
  } catch (err) {
    throw new Error(
      `Could not fetch the page: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`The page returned HTTP ${res.status}.`);
  if (!/html/i.test(res.headers.get("content-type") ?? "")) {
    throw new Error("That URL is not an HTML page.");
  }
  const html = await res.text();
  const finalUrl = res.url || target.toString();
  const host = (() => {
    try {
      return new URL(finalUrl);
    } catch {
      return target;
    }
  })();
  const domain = host.hostname.replace(/^www\./, "");
  const siteName =
    toAscii(metaContent(html, ["og:site_name", "application-name"]) ?? "").trim() ||
    domain;
  return { html, finalUrl, domain, siteName, frameable: computeFrameable(res) };
}

/** Derive a site identity from a bare URL (no fetch), for the paste fallback. */
export function siteIdentity(rawUrl: string): { finalUrl: string; domain: string; siteName: string } {
  const u = assertPublicHttpUrl(rawUrl.trim());
  const domain = u.hostname.replace(/^www\./, "");
  return { finalUrl: u.toString(), domain, siteName: domain };
}

/**
 * Fetch a blog/article URL and extract a normalised summary using Open Graph /
 * meta tags, falling back to <title> and the article body. Never returns
 * non-ASCII. Throws when the page cannot be fetched or has no title, so the
 * caller can offer the AI or paste fallback.
 */
export async function scrapeArticle(rawUrl: string): Promise<ScrapedArticle> {
  const { html, finalUrl, domain, siteName } = await fetchPage(rawUrl);

  const title =
    toAscii(
      metaContent(html, ["og:title", "twitter:title"]) ??
        tagText(html, "title") ??
        "",
    ).trim() || null;
  if (!title) throw new Error("Could not find a title on that page.");

  const ogDescription = metaContent(html, ["og:description", "description"]);
  const body = bodyExcerpt(html);
  const description =
    (ogDescription ? toAscii(ogDescription).trim() : null) ??
    (body ? body.slice(0, 500) : null);

  return {
    title,
    description,
    publishedAt: metaPublished(html),
    finalUrl,
    siteName,
    domain,
  };
}

type AiExtract = { title: string | null; summary: string | null; publishedDate: string | null };

function parseAiJson(text: string): AiExtract | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const o = JSON.parse(match[0]) as Record<string, unknown>;
    return {
      title: typeof o.title === "string" ? o.title : null,
      summary: typeof o.summary === "string" ? o.summary : null,
      publishedDate: typeof o.publishedDate === "string" ? o.publishedDate : null,
    };
  } catch {
    return null;
  }
}

/**
 * Fallback reader: fetch the page, then use the LLM to pull a title, summary and
 * date out of the raw text when the heuristic scraper could not. Requires an
 * Anthropic API key; throws (so the caller can offer paste) if unavailable or if
 * the page has no readable text.
 */
export async function scrapeArticleWithAI(rawUrl: string): Promise<ScrapedArticle> {
  const { html, finalUrl, domain, siteName } = await fetchPage(rawUrl);

  const key = serverEnv.anthropicApiKey;
  if (!key) {
    throw new Error("AI reading is not configured. Paste the text instead.");
  }
  const titleHint = toAscii(
    metaContent(html, ["og:title", "twitter:title"]) ?? tagText(html, "title") ?? "",
  ).trim();
  const text = bodyExcerpt(html) ?? "";
  if (!text && !titleHint) {
    throw new Error("The page has no readable text. Paste the text instead.");
  }

  const client = new Anthropic({ apiKey: key });
  const message = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 512,
    system:
      "You extract article metadata from raw web page text. Return ONLY strict JSON " +
      '{"title": string, "summary": string, "publishedDate": string|null}. ' +
      "summary is 2-4 plain sentences describing the article's substance. " +
      "publishedDate is ISO 8601 (YYYY-MM-DD) if stated, else null. Use ASCII only.",
    messages: [
      {
        role: "user",
        content: `URL: ${finalUrl}\nTitle hint: ${titleHint || "(none)"}\n\nPage text:\n${text.slice(0, 12000)}`,
      },
    ],
  });
  const out = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = parseAiJson(out);

  const title = toAscii(parsed?.title || titleHint).trim();
  if (!title) throw new Error("AI could not identify a title. Paste the text instead.");
  const summary = parsed?.summary ? toAscii(parsed.summary).trim().slice(0, 800) : null;
  const description = summary ?? (text ? text.slice(0, 500) : null);
  const publishedAt = parseDate(parsed?.publishedDate ?? null) ?? metaPublished(html);

  return { title, description, publishedAt, finalUrl, siteName, domain };
}

/** Extract the article body as newline-separated paragraphs (best-effort). */
function articleParagraphs(html: string): string {
  const scope = contentScope(html);
  const withBreaks = scope
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(header|nav|footer|aside|form)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>(?=\s*\S)/gi, "\n")
    .replace(/<\/(p|div|section|article|h[1-6]|li|ul|ol|blockquote|tr|figcaption)>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ");
  return toAscii(withBreaks, true)
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Prepare fetched HTML for rendering in a sandboxed `srcdoc` iframe. Injects a
 * `<base>` so the page's relative CSS, images, scripts and links resolve against
 * the source, and drops any page-level CSP/framing meta that would otherwise
 * block those subresources. Scripts are kept so bodies that render client-side
 * still populate; the iframe is sandboxed without `allow-same-origin`, so this
 * HTML runs in an opaque origin and can neither reach our page nor bust out.
 */
function prepareEmbedHtml(html: string, baseUrl: string): string {
  const base = `<base href="${baseUrl.replace(/"/g, "%22")}">`;
  const cleaned = html.replace(
    /<meta[^>]+http-equiv=["']?(?:content-security-policy|x-frame-options)["']?[^>]*>/gi,
    "",
  );
  return /<head[^>]*>/i.test(cleaned)
    ? cleaned.replace(/<head([^>]*)>/i, `<head$1>${base}`)
    : `${base}${cleaned}`;
}

// A body shorter than this is treated as "no real content" (a challenge
// interstitial or JS-only shell that still returned 200), so we try the reader.
const MIN_BODY_CHARS = 200;

/**
 * Last-resort reader for pages a direct fetch cannot get (Cloudflare JS
 * challenge, bot walls): route the URL through a configured reader proxy
 * (READER_PROXY_URL, e.g. https://r.jina.ai/) that renders the page and returns
 * clean article text. Disabled - returns null - unless the proxy is configured,
 * and null on any failure, so callers keep their existing fallback behaviour.
 * The article URL is validated first (SSRF guard) before being handed to it.
 */
async function fetchViaReader(rawUrl: string): Promise<string | null> {
  const base = serverEnv.readerProxyUrl;
  if (!base) return null;
  let target: URL;
  try {
    target = assertPublicHttpUrl(rawUrl.trim());
  } catch {
    return null;
  }
  const proxied =
    (base.endsWith("/") ? base : `${base}/`) + target.toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Note: no browser User-Agent here - reader proxies (e.g. Jina) reject
    // browser-like UAs with 403; they expect an API-style caller.
    const headers: Record<string, string> = { "X-Return-Format": "text" };
    const key = serverEnv.readerProxyKey;
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(proxied, {
      redirect: "follow",
      signal: controller.signal,
      headers,
    });
    if (!res.ok) return null;
    const text = toAscii(await res.text(), true)
      .replace(/[ \t]+/g, " ")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type ArticleView = { frameable: boolean; html: string; text: string };

/**
 * Fetch a report URL once (as a browser) and return everything the details
 * modal needs to display it: whether the page's headers allow embedding the
 * live URL, a self-contained HTML snapshot for a sandboxed `srcdoc` render when
 * they do not, and the scraped article text as a final fallback. Throws on
 * fetch / non-HTML failures so the caller can fall back to the source link.
 */
export async function fetchArticleView(rawUrl: string): Promise<ArticleView> {
  try {
    const { html, frameable, finalUrl } = await fetchPage(rawUrl);
    const text = articleParagraphs(html);
    const snapshot = prepareEmbedHtml(html, finalUrl);
    // A real page: show it (live frame or snapshot) as before.
    if (text.length >= MIN_BODY_CHARS) return { frameable, html: snapshot, text };
    // Fetched OK but the body reads as empty (a challenge or JS-only shell). The
    // reader may recover better text, but the page itself was retrieved, so keep
    // the snapshot: dropping it would downgrade a viewable page to text only.
    const reader = await fetchViaReader(rawUrl);
    return { frameable, html: snapshot, text: reader ?? text };
  } catch (err) {
    // Blocked outright (e.g. Cloudflare 403): recover text via the reader if one
    // is configured, else rethrow so the modal shows "could not load".
    const reader = await fetchViaReader(rawUrl);
    if (reader) return { frameable: false, html: "", text: reader };
    throw err;
  }
}

/**
 * Fetch a report URL and return just its article body as paragraph-broken text,
 * for server-side IOC extraction during ingest. Throws on fetch / non-HTML
 * failures so the caller can treat it as a report with no IOCs.
 */
export async function fetchArticleText(rawUrl: string): Promise<string> {
  try {
    const { html } = await fetchPage(rawUrl);
    const text = articleParagraphs(html);
    if (text.length >= MIN_BODY_CHARS) return text;
    return (await fetchViaReader(rawUrl)) ?? text;
  } catch (err) {
    const reader = await fetchViaReader(rawUrl);
    if (reader) return reader;
    throw err;
  }
}
