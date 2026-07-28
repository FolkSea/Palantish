import Parser from "rss-parser";
import type { RawCandidate } from "./types";
import { toAscii } from "@/lib/text";

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
  // Strip tags, then decode entities and force ASCII (drops &#8211; etc.).
  const text = toAscii(html.replace(/<[^>]*>/g, " "));
  return text ? text.slice(0, 500) : null;
}

/** Freshness result for one feed after a pull. */
export type FeedHealth = {
  name: string;
  latestItemAt: Date | null; // newest item date seen, or null on error/empty
  error: string | null;
};

/**
 * Pull and normalise entries from a single RSS/Atom feed. Errors are swallowed
 * (a single dead feed must not fail the whole run) and reported via the return.
 */
export async function pullFeed(
  source: FeedSource,
): Promise<{
  candidates: RawCandidate[];
  error?: string;
  latestItemAt: Date | null;
}> {
  if (!source.feed_url) return { candidates: [], latestItemAt: null };
  try {
    const feed = await parser.parseURL(source.feed_url);
    const candidates: RawCandidate[] = (feed.items ?? [])
      .filter((i) => i.title && i.link)
      .map((i) => ({
        title: toAscii(i.title),
        url: i.link!.trim(),
        description: clean(i.contentSnippet ?? i.content ?? i.summary),
        publishedAt: toDate(i.isoDate ?? i.pubDate),
        sourceName: source.name,
        sourceCategory: source.category,
      }));
    const latestItemAt = candidates.reduce<Date | null>((max, c) => {
      if (!c.publishedAt) return max;
      return !max || c.publishedAt > max ? c.publishedAt : max;
    }, null);
    return { candidates, latestItemAt };
  } catch (err) {
    return {
      candidates: [],
      error: err instanceof Error ? err.message : String(err),
      latestItemAt: null,
    };
  }
}

/** Pull all feeds concurrently, returning candidates, errors, and health. */
export async function pullAllFeeds(sources: FeedSource[]): Promise<{
  candidates: RawCandidate[];
  errors: string[];
  health: FeedHealth[];
}> {
  const results = await Promise.all(sources.map((s) => pullFeed(s)));
  const candidates = results.flatMap((r) => r.candidates);
  const errors = results
    .map((r, i) => (r.error ? `${sources[i].name}: ${r.error}` : null))
    .filter((e): e is string => e !== null);
  const health: FeedHealth[] = results.map((r, i) => ({
    name: sources[i].name,
    latestItemAt: r.latestItemAt,
    error: r.error ?? null,
  }));
  return { candidates, errors, health };
}
