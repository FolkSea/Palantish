// A reader for the CERT-EU blog, which publishes no usable feed.
//
// https://cert.europa.eu/blog lists every post in one page of consistent
// markup, so this parses that listing rather than depending on a feed that does
// not exist. Pure (no network) so the parsing is unit-tested against a captured
// page; the fetch lives in the registry that calls it.

import type { RawCandidate } from "../types";
import { toAscii } from "@/lib/text";
import { ZONE_OFFSET_HOURS } from "../dates";

const ARTICLE_RE = /<article class="news--articles--item">([\s\S]*?)<\/article>/gi;
const TIME_RE = /<time[^>]*class="news--articles--item--time"[^>]*>([\s\S]*?)<\/time>/i;
const TITLE_RE =
  /<h3[^>]*class="news--articles--item--title"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
const DESCRIPTION_RE =
  /<p[^>]*class="news--articles--item--description"[^>]*>([\s\S]*?)<\/p>/i;

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const DATE_RE =
  /^(?:\w+,\s*)?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\s*([A-Z]{3,4})?$/i;

/**
 * Parse the date CERT-EU prints, e.g.
 * "Tuesday, April 21, 2026 05:50:00 PM CEST".
 *
 * The `datetime` attribute on the same element is NOT usable: every post on the
 * page carries the identical hardcoded value 2001-05-15T19:00, so the only real
 * date is this text. Parsed field by field and converted from CET/CEST, because
 * `new Date` rejects the zone suffix outright and stripping it would silently
 * read the string in whatever timezone the server happens to run in.
 */
export function parseCertEuDate(text: string): Date | null {
  const s = toAscii(text).replace(/\s+/g, " ").trim();
  const m = DATE_RE.exec(s);
  if (!m) return null;

  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  const day = Number(m[2]);
  const year = Number(m[3]);
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] ?? 0);
  const meridiem = m[7]?.toUpperCase();
  const zone = m[8]?.toUpperCase();

  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59 || second > 59 || day < 1 || day > 31) return null;

  // An unrecognised zone is treated as UTC rather than guessed at: an hour out
  // is better than a date that silently lands in the server's own timezone.
  const offset = zone ? (ZONE_OFFSET_HOURS[zone] ?? 0) : 0;
  const d = new Date(Date.UTC(year, month, day, hour - offset, minute, second));
  return Number.isNaN(d.getTime()) ? null : d;
}

function stripTags(html: string): string {
  return toAscii(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Every post on the CERT-EU blog listing, newest first as published.
 *
 * A post missing a title or link is skipped - there is nothing to ingest - but a
 * post with an unparseable date is kept with a null date, because the pipeline
 * handles undated candidates and dropping real reporting over a date format
 * change would be worse than showing it undated.
 */
export function parseCertEuBlog(
  html: string,
  baseUrl: string,
  source: { name: string; category: RawCandidate["sourceCategory"] },
): RawCandidate[] {
  const out: RawCandidate[] = [];
  ARTICLE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ARTICLE_RE.exec(html)) !== null) {
    const block = match[1];
    const title = TITLE_RE.exec(block);
    if (!title) continue;

    const href = title[1].trim();
    const text = stripTags(title[2]);
    if (!text || !href) continue;

    let url: string;
    try {
      url = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }

    const time = TIME_RE.exec(block);
    const description = DESCRIPTION_RE.exec(block);
    out.push({
      title: text,
      url,
      description: description ? stripTags(description[1]).slice(0, 500) || null : null,
      publishedAt: time ? parseCertEuDate(stripTags(time[1])) : null,
      sourceName: source.name,
      sourceCategory: source.category,
    });
  }
  return out;
}
