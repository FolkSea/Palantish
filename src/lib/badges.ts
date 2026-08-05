// Shared badge styling + CrowdStrike adversary-naming helpers.
// All labels are plain ASCII (no emoji / decorative glyphs).

export type Confidence = "confirmed" | "suspected" | "poc";

export const CONFIDENCE_STYLE: Record<
  Confidence,
  { label: string; className: string }
> = {
  confirmed: {
    label: "CONFIRMED",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  suspected: {
    label: "SUSPECTED",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  poc: {
    label: "POC",
    className: "bg-sky-50 text-sky-700 border-sky-200",
  },
};

// Vulnerability status uses the same vocabulary as confidence.
export const VULN_STATUS_STYLE = CONFIDENCE_STYLE;

// Reports carry an attribution confidence (how sure the attribution is) on a
// separate High / Medium / Low scale, defaulting to Medium.
export type ReportConfidence = "high" | "medium" | "low";

export const REPORT_CONFIDENCES: ReportConfidence[] = ["high", "medium", "low"];

export const REPORT_CONFIDENCE_LABEL: Record<ReportConfidence, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const REPORT_CONFIDENCE_STYLE: Record<
  ReportConfidence,
  { label: string; className: string }
> = {
  high: {
    label: "HIGH",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  medium: {
    label: "MEDIUM",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  low: {
    label: "LOW",
    className: "bg-slate-100 text-slate-600 border-slate-300",
  },
};

// Derived priority for the exploits/vulnerabilities table (see lib/vuln-priority).
export type VulnPriority = "critical" | "high" | "medium";

export const PRIORITY_STYLE: Record<
  VulnPriority,
  { label: string; className: string }
> = {
  critical: {
    label: "CRITICAL",
    className: "bg-red-100 text-red-800 border-red-300",
  },
  high: {
    label: "HIGH",
    className: "bg-orange-50 text-orange-700 border-orange-300",
  },
  medium: {
    label: "MEDIUM",
    className: "bg-yellow-50 text-yellow-800 border-yellow-300",
  },
};

export type Nexus =
  | "china"
  | "russia"
  | "north_korea"
  | "iran"
  | "rest_of_world"
  | "other";

/**
 * Every CrowdStrike animal family, and the country it implies (null when the
 * family is not country-specific: BAT is any unidentified state, SPIDER eCrime,
 * JACKAL hacktivism).
 *
 * This is the one list of families in the codebase. It stays in code rather
 * than the database because it describes the naming convention itself, not the
 * catalogue: `adversaries` rows carry a name and a country, never a family. It
 * had drifted into four partial copies - the generic-name guard below, the
 * rest-of-world lookup, the ingest classifier and the UNID dropdown - which is
 * how a bare "Kitten" reached the timeline as though it were a group.
 */
export const ANIMAL_COUNTRY: Record<string, string | null> = {
  PANDA: "China",
  BEAR: "Russia",
  CHOLLIMA: "North Korea",
  KITTEN: "Iran",
  TIGER: "India",
  WOLF: "Turkey",
  BUFFALO: "Vietnam",
  LEOPARD: "Pakistan",
  CRANE: "South Korea",
  BAT: null,
  SPIDER: null,
  JACKAL: null,
};

// All adversary-name labels share one red scheme, regardless of nexus/animal.
export const ADVERSARY_BADGE_CLASS = "border-red-200 bg-red-50 text-red-700";

// Animal used for an UNIDentified actor attributed to a nexus (eCrime = Spider).
export const UNID_ANIMAL_BY_NEXUS: Record<Nexus, string> = {
  china: "Panda",
  russia: "Bear",
  north_korea: "Chollima",
  iran: "Kitten",
  rest_of_world: "Bat",
  other: "Spider",
};

// Country -> animal, for the rest-of-the-world families. Derived, so adding a
// family above is all it takes.
const ANIMAL_BY_COUNTRY = new Map(
  Object.entries(ANIMAL_COUNTRY)
    .filter(([, country]) => country !== null)
    .map(([animal, country]) => [country!.toLowerCase(), animal]),
);

/** The animal family a country implies, or null when it names no family. */
export function animalForCountry(country: string | null | undefined): string | null {
  return ANIMAL_BY_COUNTRY.get((country ?? "").trim().toLowerCase()) ?? null;
}

// Adjective forms, only for the fallback that reads the report text when the
// row carries no country of its own.
const COUNTRY_ADJECTIVE: Record<string, string> = {
  India: "indian",
  Turkey: "turkish",
  Vietnam: "vietnamese",
  Pakistan: "pakistani",
  "South Korea": "south korean",
};

const ROW_ANIMAL_BY_COUNTRY: [RegExp, string][] = Object.entries(ANIMAL_COUNTRY)
  .filter(([, c]) => c !== null && c in COUNTRY_ADJECTIVE)
  .map(([animal, c]) => [
    new RegExp(`\\b(${c!.toLowerCase()}|${COUNTRY_ADJECTIVE[c!]})\\b`, "i"),
    animal,
  ]);

/** CrowdStrike animal for a Rest-of-the-World item, by country named in text. */
export function restOfWorldAnimal(text: string): string {
  for (const [re, animal] of ROW_ANIMAL_BY_COUNTRY) if (re.test(text)) return animal;
  return "BAT";
}

// Values that name only an animal or a placeholder, i.e. not a specific group.
// Every family counts: "Kitten" is a naming convention, not an actor.
const GENERIC_ADVERSARY = new Set([
  ...Object.keys(ANIMAL_COUNTRY),
  "",
  "UNKNOWN",
  "UNID",
  "UNATTRIBUTED",
  "N/A",
]);

/** True when the name identifies a specific group (not a bare animal/placeholder). */
export function isSpecificAdversary(name: string | null | undefined): boolean {
  if (!name) return false;
  return !GENERIC_ADVERSARY.has(name.trim().toUpperCase());
}

/**
 * Final adversary label for an item attributed to `nexus`: the specific group
 * name when there is one, otherwise "UNID <animal>" (e.g. UNID BEAR / UNID SPIDER).
 */
export function adversaryLabel(
  name: string | null | undefined,
  nexus: Nexus,
  text = "",
  /** The country stored on the row, which beats guessing from the text. */
  country?: string | null,
): string {
  if (isSpecificAdversary(name)) return name as string;
  // Animal (family) is always upper-cased: UNID BAT, UNID PANDA, ...
  if (nexus === "rest_of_world") {
    // The row states the country; only fall back to the text when it does not.
    // Reading the text first labelled an India-carded report UNID BAT whenever
    // its summary happened not to say "India".
    const animal = animalForCountry(country) ?? restOfWorldAnimal(text);
    return `UNID ${animal.toUpperCase()}`;
  }
  return `UNID ${UNID_ANIMAL_BY_NEXUS[nexus].toUpperCase()}`;
}

export const NEXUS_ACCENT: Record<Nexus, string> = {
  china: "#dc2626",
  russia: "#2563eb",
  north_korea: "#7c3aed",
  iran: "#f59e0b",
  rest_of_world: "#0d9488",
  other: "#475569",
};

/**
 * Chip colours for the taxonomy labels the triage agent assigns, keyed by the
 * label's prefix (Adversary/..., Target/..., Malware/..., AI/...). Matching is
 * case-insensitive; a label with any other prefix - including one an analyst
 * typed by hand - falls back to the neutral slate chip.
 */
export const LABEL_CHIP_STYLE: Record<string, string> = {
  adversary: "bg-red-100 text-red-700 hover:bg-red-200 hover:text-red-900",
  target:
    "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 hover:text-emerald-900",
  malware: "bg-pink-100 text-pink-700 hover:bg-pink-200 hover:text-pink-900",
  ai: "bg-orange-100 text-orange-700 hover:bg-orange-200 hover:text-orange-900",
};

const LABEL_CHIP_DEFAULT =
  "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-800";

/** The chip classes for one label, chosen from its prefix. */
export function labelChipClass(label: string): string {
  const prefix = (label ?? "").split("/")[0]?.trim().toLowerCase() ?? "";
  return LABEL_CHIP_STYLE[prefix] ?? LABEL_CHIP_DEFAULT;
}
