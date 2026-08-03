// Dates as feeds actually publish them.
//
// `new Date` handles numeric offsets ("+0200") and a handful of US zone
// abbreviations, but rejects European ones outright: "Thu, 23 Jul 2026 09:13:03
// CEST" is an Invalid Date, not an approximation. CERT-EU publishes exactly that
// in every pubDate, which silently left the whole feed undated.

/** Fixed offsets for the zone names European feeds emit. */
export const ZONE_OFFSET_HOURS: Record<string, number> = {
  UTC: 0,
  GMT: 0,
  WET: 0,
  WEST: 1,
  CET: 1,
  CEST: 2,
  EET: 2,
  EEST: 3,
  BST: 1,
};

const ZONE_SUFFIX_RE = /\s+([A-Z]{2,4})\s*$/;

function offsetString(hours: number): string {
  const sign = hours < 0 ? "-" : "+";
  const abs = Math.abs(hours);
  return `${sign}${String(Math.floor(abs)).padStart(2, "0")}${String(
    Math.round((abs % 1) * 60),
  ).padStart(2, "0")}`;
}

/**
 * Parse a feed's date string, falling back to a named-zone rewrite when the
 * engine refuses it. Returns null rather than a wrong date: an item with no
 * date is handled everywhere, an item dated 1970 or dated in the server's own
 * timezone is a silent error.
 */
export function parseFeedDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  // Swap a trailing zone name for its numeric offset and retry.
  const m = ZONE_SUFFIX_RE.exec(raw);
  if (m) {
    const hours = ZONE_OFFSET_HOURS[m[1].toUpperCase()];
    if (hours !== undefined) {
      const rewritten = raw.replace(ZONE_SUFFIX_RE, ` ${offsetString(hours)}`);
      const parsed = new Date(rewritten);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return null;
}
