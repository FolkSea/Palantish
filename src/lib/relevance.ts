// Pure, dependency-free relevance filter for the dashboard. Drops posts that are
// marketing, corporate/business news, event/contest promotion, podcasts /
// newsletters / roundups, or consumer-lifestyle stories, keeping only genuine
// threat intelligence. Applied at display time (see lib/data) so it also cleans
// already-ingested items; the ingest LLM classifier enforces the same policy at
// the source for new items.

// High-precision "not threat intel" signals. Deliberately avoids bare tokens
// like "partner", "announce", or "sponsor" that legitimately appear in genuine
// reporting ("CISA and partners", "state-sponsored actor", "vendor announces
// patch"), which would otherwise drop real intelligence.
const OFF_TOPIC = new RegExp(
  [
    // Podcasts / newsletters / roundups
    "\\block and code\\b",
    "\\bs\\d{1,2}e\\d{1,2}\\b", // episode tag, e.g. S07E15
    "\\ba week in security\\b",
    "\\bthis week in\\b",
    "\\bweekly (recap|roundup|digest)\\b",
    "\\bpodcast\\b",
    // Events / contests / conferences
    "\\bpwn2own\\b",
    "\\bblack hat\\b",
    "\\bdef con\\b",
    "\\brsa conference\\b",
    "\\bpreview:",
    "\\bwebinar\\b",
    // Vendor product / corporate self-promotion
    "\\buse cases (for|of)\\b",
    "\\bjoins (the|forces)\\b",
    "\\balliance to\\b",
    "\\bplatform helps\\b",
    "\\bhelps meet\\b",
    "\\bhelps (organi[sz]ations|customers|you)\\b",
    "\\bgeneral availability\\b",
    "\\bmagic quadrant\\b",
    "\\bgartner\\b",
    "\\bforrester\\b",
    "\\bnamed a leader\\b",
    "\\bstrengthen(s|ing)? (cyber )?resilience\\b",
    "\\bcustomer story\\b",
    "\\bcase study\\b",
    "\\bregister (now|today)\\b",
    "\\bwhitepaper series\\b",
    // Corporate / business news
    "\\bacquisition\\b",
    "\\bacquires\\b",
    "\\bmerger\\b",
    "\\bfunding round\\b",
    "\\braises \\$",
    "\\bseries [a-e] funding\\b",
    "\\bearnings\\b",
    "\\blegal scrutiny\\b",
    // Consumer / lifestyle awareness
    "\\bdon'?t get fooled\\b",
    "\\bdon'?t trust\\b",
  ].join("|"),
  "i",
);

// Concrete threat-intel signals that override an off-topic match, so a genuinely
// technical report is never dropped because of an incidental keyword.
const STRONG_INTEL = new RegExp(
  [
    "\\bmalware\\b",
    "\\bransomware\\b",
    "\\bexploit(ed|ation|s)?\\b",
    "\\bvulnerabilit",
    "\\bcve-\\d",
    "\\bzero.?day\\b",
    "\\bbackdoor\\b",
    "\\bc2\\b",
    "\\bcommand.and.control\\b",
    "\\bbotnet\\b",
    "\\bphishing\\b",
    "\\bthreat actor\\b",
    "\\bapt\\d",
    "\\bespionage\\b",
    "\\bstealer\\b",
    "\\btrojan\\b",
    "\\brootkit\\b",
    "\\bspyware\\b",
    "\\bimplant\\b",
    "\\bexfiltrat",
    "\\bdata (leak|breach)\\b",
    "\\bthreat landscape\\b",
  ].join("|"),
  "i",
);

/**
 * True when an item reads as genuine threat intelligence (keep it), false when
 * it looks like marketing / business / event / podcast / lifestyle content. An
 * off-topic match is overridden when the text also carries a concrete threat
 * signal, so technical reporting is not dropped for an incidental keyword.
 */
export function isThreatIntel(
  title: string | null | undefined,
  description?: string | null,
): boolean {
  const hay = `${title ?? ""} ${description ?? ""}`;
  if (!OFF_TOPIC.test(hay)) return true;
  return STRONG_INTEL.test(hay);
}
