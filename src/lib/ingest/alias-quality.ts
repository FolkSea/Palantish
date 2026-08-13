// Which catalogue aliases are distinctive enough to attribute a report.
//
// An alias becomes a matcher over report text, so an alias that is also an
// ordinary English word attributes everything. WINNTI GROUP carried the alias
// "LEAD", which matches "lead to" and "the lead researcher", and quietly
// claimed reports about browser extensions. RECESS SPIDER carries "Play",
// ROYAL SPIDER "Royal", VENOMOUS BEAR "Snake".
//
// Pure, so the rule is testable without a catalogue or a database.

/**
 * Ordinary words that are also somebody's alias.
 *
 * Only single-word aliases are checked against this, so a phrase built from
 * these words - "Dark Halo", "Static Kitten" - is unaffected: it is the whole
 * phrase that has to be distinctive, not each word in it.
 *
 * Deliberately not a general dictionary. These are words that turn up in
 * security reporting, which is the text the matcher runs over; a rare word that
 * happens to be in the language is not a problem, a common one is.
 */
const ORDINARY_WORDS = new Set([
  // Observed in the catalogue, each one an attribution bug waiting to happen.
  "lead",
  "play",
  "royal",
  "hive",
  "snake",
  "tick",
  "grief",
  "maze",
  "gold",
  "silver",
  "bronze",
  "copper",
  "iron",
  // Words a report about anything at all is likely to contain.
  "cloud",
  "storm",
  "shadow",
  "ghost",
  "light",
  "stone",
  "sand",
  "dust",
  "comment",
  "group",
  "team",
  "crew",
  "force",
  "unit",
  "sector",
  "energy",
  "solar",
  "lunar",
  "orange",
  "blue",
  "green",
  "white",
  "black",
  "grey",
  "gray",
  "magic",
  "mint",
  "moth",
  "wolf",
  "bear",
  "panda",
  "tiger",
  "kitten",
  "spider",
  "jackal",
  "crane",
  "leopard",
  "buffalo",
  "dark",
  "static",
  "mission",
  "charming",
  "cosmic",
  "phantom",
  "wizard",
]);

/** Aliases shorter than this are too generic to match safely. */
export const MIN_ALIAS_LEN = 4;

/**
 * Whether an alias may attribute a report at all.
 *
 * A single ordinary word never can. Anything else that clears the length floor
 * may: a phrase, a designator with a digit in it, an acronym - all of them are
 * things a writer only puts in a report on purpose.
 */
export function isMatchableAlias(alias: string): boolean {
  const value = (alias ?? "").trim();
  if (value.length < MIN_ALIAS_LEN) return false;
  const single = !/\s/.test(value);
  return !(single && ORDINARY_WORDS.has(value.toLowerCase()));
}

/**
 * Whether an alias is strong enough to attribute from the body of an article
 * alone.
 *
 * The body is the whole fetched page - the navigation, the related-article
 * teasers and the footer along with the report - so a single mention in it is
 * not the same evidence as a mention in the title. A phrase or a designator
 * carrying a digit is deliberate; a lone coined word may be a link to last
 * week's story.
 */
export function isStrongAlias(alias: string): boolean {
  const value = (alias ?? "").trim();
  if (!isMatchableAlias(value)) return false;
  return /\s/.test(value) || /\d/.test(value);
}
