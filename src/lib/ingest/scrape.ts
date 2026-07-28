import "server-only";

import { toAscii } from "@/lib/text";

export type ScrapedArticle = {
  title: string;
  description: string | null;
  publishedAt: Date | null;
  finalUrl: string;
  siteName: string;
  domain: string;
};

const FETCH_TIMEOUT_MS = 20000;
const UA = "Mozilla/5.0 (compatible; ThreatDashboardBot/1.0; +manual-import)";

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

/** Extract the main body text (article scope if present, else body), tag-stripped. */
function bodyExcerpt(html: string): string | null {
  const article = html.match(/<article\b[\s\S]*?<\/article>/i)?.[0];
  const main = html.match(/<main\b[\s\S]*?<\/main>/i)?.[0];
  const body = html.match(/<body\b[\s\S]*?<\/body>/i)?.[0];
  const scope = article ?? main ?? body ?? html;
  const stripped = scope
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const text = toAscii(stripped).replace(/\s+/g, " ").trim();
  return text || null;
}

/**
 * Fetch a blog/article URL and extract a normalised summary for ingestion.
 * Uses Open Graph / Twitter / standard meta tags, falling back to <title> and
 * the article body. Never returns non-ASCII (everything runs through toAscii).
 */
export async function scrapeArticle(rawUrl: string): Promise<ScrapedArticle> {
  const target = assertPublicHttpUrl(rawUrl.trim());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(target, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    });
  } catch (err) {
    throw new Error(
      `Could not fetch the page: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`The page returned HTTP ${res.status}.`);
  const contentType = res.headers.get("content-type") ?? "";
  if (!/html/i.test(contentType)) {
    throw new Error("That URL is not an HTML page.");
  }
  const html = await res.text();
  const finalUrl = res.url || target.toString();
  const finalHost = (() => {
    try {
      return new URL(finalUrl);
    } catch {
      return target;
    }
  })();

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

  const publishedAt = parseDate(
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

  const domain = finalHost.hostname.replace(/^www\./, "");
  const siteName =
    toAscii(metaContent(html, ["og:site_name", "application-name"]) ?? "").trim() ||
    domain;

  return { title, description, publishedAt, finalUrl, siteName, domain };
}
