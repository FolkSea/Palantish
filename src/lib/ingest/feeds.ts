import Parser from "rss-parser";
import type { RawCandidate } from "./types";

export type FeedSource = {
  name: string;
  feed_url: string | null;
  category: "vendor" | "research" | "news" | "government" | null;
};

const parser = new Parser({ timeout: 15000 });

function toDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clean(html: string | undefined): string | null {
  if (!html) return null;
  // Strip tags and collapse whitespace; keep it short.
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 500) : null;
}

/**
 * Pull and normalise entries from a single RSS/Atom feed. Errors are swallowed
 * (a single dead feed must not fail the whole run) and reported via the return.
 */
export async function pullFeed(
  source: FeedSource,
): Promise<{ candidates: RawCandidate[]; error?: string }> {
  if (!source.feed_url) return { candidates: [] };
  try {
    const feed = await parser.parseURL(source.feed_url);
    const candidates: RawCandidate[] = (feed.items ?? [])
      .filter((i) => i.title && i.link)
      .map((i) => ({
        title: i.title!.trim(),
        url: i.link!.trim(),
        description: clean(i.contentSnippet ?? i.content ?? i.summary),
        publishedAt: toDate(i.isoDate ?? i.pubDate),
        sourceName: source.name,
        sourceCategory: source.category,
      }));
    return { candidates };
  } catch (err) {
    return {
      candidates: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Pull all feeds concurrently. */
export async function pullAllFeeds(
  sources: FeedSource[],
): Promise<{ candidates: RawCandidate[]; errors: string[] }> {
  const results = await Promise.all(sources.map((s) => pullFeed(s)));
  const candidates = results.flatMap((r) => r.candidates);
  const errors = results
    .map((r, i) => (r.error ? `${sources[i].name}: ${r.error}` : null))
    .filter((e): e is string => e !== null);
  return { candidates, errors };
}
