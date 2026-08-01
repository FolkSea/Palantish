import Parser from "rss-parser";
import type { RawCandidate } from "./types";
import { toAscii } from "@/lib/text";
import { ilog } from "./log";

export type FeedSource = {
  name: string;
  feed_url: string | null;
  category: "vendor" | "research" | "news" | "government" | null;
};

const parser = new Parser({ timeout: 15000 });

// Take at most this many (newest) items per feed. Guards against firehose feeds
// (e.g. the MSRC Security Update Guide returns thousands of CVE entries) that
// would otherwise dump a huge batch on the first ingest. Normal feeds return
// far fewer than this, so they are unaffected.
const MAX_ITEMS_PER_FEED = 40;

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
  const startedAt = Date.now();
  try {
    const feed = await parser.parseURL(source.feed_url);
    const all: RawCandidate[] = (feed.items ?? [])
      .filter((i) => i.title && i.link)
      .map((i) => ({
        title: toAscii(i.title),
        url: i.link!.trim(),
        description: clean(i.contentSnippet ?? i.content ?? i.summary),
        publishedAt: toDate(i.isoDate ?? i.pubDate),
        sourceName: source.name,
        sourceCategory: source.category,
      }));
    // Keep only the newest MAX_ITEMS_PER_FEED (undated items sort last).
    const candidates = [...all]
      .sort(
        (a, b) =>
          (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
      )
      .slice(0, MAX_ITEMS_PER_FEED);
    const latestItemAt = candidates.reduce<Date | null>((max, c) => {
      if (!c.publishedAt) return max;
      return !max || c.publishedAt > max ? c.publishedAt : max;
    }, null);
    const ms = Date.now() - startedAt;
    ilog(
      `feed "${source.name}": ${candidates.length} items` +
        (latestItemAt ? `, latest ${latestItemAt.toISOString().slice(0, 10)}` : "") +
        ` (${ms}ms)`,
    );
    return { candidates, latestItemAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ilog(`feed "${source.name}": ERROR ${message} (${Date.now() - startedAt}ms)`);
    return { candidates: [], error: message, latestItemAt: null };
  }
}

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
