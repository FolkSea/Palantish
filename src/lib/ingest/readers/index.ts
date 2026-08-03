// Custom readers for sources that publish no usable feed.
//
// A source with feed_type "scraper" is matched here by its URL and parsed from
// its listing page instead. Keeping the dispatch in one table means adding the
// next site is one entry plus one pure parser, and a source whose feed later
// starts working just goes back to feed_type "rss".

import type { RawCandidate } from "../types";
import { parseCertEuBlog } from "./cert-eu-blog";

export type ReaderSource = {
  name: string;
  category: RawCandidate["sourceCategory"];
};

export type Reader = {
  /** Shown in logs and errors. */
  id: string;
  /** Whether this reader handles the given listing URL. */
  matches: (url: URL) => boolean;
  parse: (html: string, url: string, source: ReaderSource) => RawCandidate[];
};

const READERS: Reader[] = [
  {
    id: "cert-eu-blog",
    matches: (u) =>
      u.hostname.endsWith("cert.europa.eu") && u.pathname.startsWith("/blog"),
    parse: parseCertEuBlog,
  },
];

/** The reader for a listing URL, or null when nothing handles it. */
export function readerFor(url: string): Reader | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return READERS.find((r) => r.matches(parsed)) ?? null;
}

export { parseCertEuBlog };
