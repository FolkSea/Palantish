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

const CS_ANIMAL_STYLE: Record<string, string> = {
  Panda: "bg-red-50 text-red-700 border-red-200",
  Bear: "bg-rose-50 text-rose-700 border-rose-200",
  Chollima: "bg-violet-50 text-violet-700 border-violet-200",
  Kitten: "bg-orange-50 text-orange-700 border-orange-200",
  Spider: "bg-slate-100 text-slate-700 border-slate-300",
};

/** Colour class for a CrowdStrike adversary name (matched by animal suffix). */
export function csAdversaryClass(name: string): string {
  const animal = Object.keys(CS_ANIMAL_STYLE).find((a) =>
    name.toUpperCase().includes(a.toUpperCase()),
  );
  return animal
    ? CS_ANIMAL_STYLE[animal]
    : "bg-slate-100 text-slate-700 border-slate-300";
}

// Nation-state colours for the timeline scatter + actor accents.
export const COUNTRY_COLOR: Record<string, string> = {
  "North Korea": "#7c3aed", // violet
  Iran: "#ea580c", // orange
  China: "#dc2626", // red
  Russia: "#e11d48", // rose
  "Rest of World": "#0d9488", // teal
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
  russia: "#e11d48",
  north_korea: "#7c3aed",
  iran: "#ea580c",
  rest_of_world: "#0d9488",
  other: "#475569",
};
