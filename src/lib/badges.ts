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
 * CrowdStrike animal cryptonym per nation-state / eCrime nexus. Used to colour
 * and validate crowdstrike_adversary badges (Panda/Bear/Chollima/Kitten/Spider).
 */
export const CS_ANIMAL_BY_NEXUS: Record<Nexus, string> = {
  china: "Panda",
  russia: "Bear",
  north_korea: "Chollima",
  iran: "Kitten",
  rest_of_world: "Tiger",
  other: "Spider",
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

// Within Rest of the World, CrowdStrike animal by country. Falls back to Bat.
const ROW_ANIMAL_BY_COUNTRY: [RegExp, string][] = [
  [/\b(india|indian)\b/i, "Tiger"],
  [/\b(turkey|turkish)\b/i, "Wolf"],
  [/\b(vietnam|vietnamese)\b/i, "Buffalo"],
  [/\b(pakistan|pakistani)\b/i, "Leopard"],
  [/\bsouth korea(n)?\b/i, "Crane"],
];

/** CrowdStrike animal for a Rest-of-the-World item, by country named in text. */
export function restOfWorldAnimal(text: string): string {
  for (const [re, animal] of ROW_ANIMAL_BY_COUNTRY) if (re.test(text)) return animal;
  return "Bat";
}

// Values that name only an animal or a placeholder, i.e. not a specific group.
const GENERIC_ADVERSARY = new Set([
  "",
  "BEAR",
  "PANDA",
  "CHOLLIMA",
  "KITTEN",
  "SPIDER",
  "BAT",
  "TIGER",
  "JACKAL",
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
): string {
  if (isSpecificAdversary(name)) return name as string;
  if (nexus === "rest_of_world") return `UNID ${restOfWorldAnimal(text)}`;
  return `UNID ${UNID_ANIMAL_BY_NEXUS[nexus]}`;
}

// Nation-state colours for the timeline scatter + actor accents. Chosen for
// maximum hue separation so adjacent rows are easy to tell apart (the old red /
// rose China/Russia pair was nearly indistinguishable). Paired with distinct
// point shapes below for redundant, colour-blind-friendly encoding.
export const COUNTRY_COLOR: Record<string, string> = {
  "North Korea": "#7c3aed", // violet
  Iran: "#f59e0b", // amber
  China: "#dc2626", // red
  Russia: "#2563eb", // blue
  "Rest of World": "#0d9488", // teal
};

// Distinct marker shape per country, so each series is identifiable by shape as
// well as colour (and remains readable in greyscale / for colour-blind users).
export const COUNTRY_POINT_STYLE: Record<
  string,
  "circle" | "triangle" | "rect" | "rectRot" | "star"
> = {
  "North Korea": "triangle",
  Iran: "rectRot", // diamond
  China: "circle",
  Russia: "rect", // square
  "Rest of World": "star",
};

// Discrete y-axis row order for the timeline (top to bottom).
export const TIMELINE_COUNTRIES = [
  "North Korea",
  "Iran",
  "China",
  "Russia",
  "Rest of World",
] as const;

export const NEXUS_ACCENT: Record<Nexus, string> = {
  china: "#dc2626",
  russia: "#2563eb",
  north_korea: "#7c3aed",
  iran: "#f59e0b",
  rest_of_world: "#0d9488",
  other: "#475569",
};
