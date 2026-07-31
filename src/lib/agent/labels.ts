// Pure helpers for the taxonomy labels the triage agent assigns to a report.
// A label is `Prefix/PascalValue` - e.g. AI/Claude, Malware/FlyingEagle,
// Adversary/FancyBear, Target/Zimbra. No DB or server imports, so it is
// unit-tested directly and shared by the agent and the ingest pipeline.

/** The four label categories and their canonical prefixes. */
export const LABEL_PREFIX = {
  ai: "AI",
  malware: "Malware",
  adversary: "Adversary",
  target: "Target",
} as const;

export type LabelCategory = keyof typeof LABEL_PREFIX;

// Per-item cap so a noisy report cannot spray dozens of labels.
const MAX_LABELS_PER_ITEM = 8;

/**
 * Normalise a raw value into the PascalCase, whitespace-free form used after the
 * prefix: split on any non-alphanumeric run, capitalise each part's first
 * character (preserving the rest so acronyms like OWA/RAT survive), and join.
 * Returns "" when nothing usable remains.
 */
export function normalizeLabelValue(raw: string): string {
  return (raw ?? "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("")
    .slice(0, 48);
}

/**
 * Build a full `Prefix/Value` label from a category and a raw value. Strips a
 * prefix the model may have already prepended (e.g. "Malware/Flying Eagle"), so
 * the category always governs the prefix. Returns null when the value is empty.
 */
export function buildLabel(category: LabelCategory, raw: string): string | null {
  const withoutPrefix = (raw ?? "").replace(
    /^\s*(ai|malware|adversary|target)\s*\/\s*/i,
    "",
  );
  const value = normalizeLabelValue(withoutPrefix);
  if (!value) return null;
  return `${LABEL_PREFIX[category]}/${value}`;
}

// Accept a few spellings per category from the model's JSON.
const CATEGORY_KEYS: Record<LabelCategory, string[]> = {
  ai: ["ai", "aiText", "ai_text"],
  malware: ["malware"],
  adversary: ["adversary", "adversaries", "actor", "actors"],
  target: ["target", "targets", "targetedSystems", "targeted_systems"],
};

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") return [v];
  return [];
}

/**
 * Parse the `labels` object from a triage response into a deduped, capped list
 * of canonical `Prefix/Value` labels. Tolerant of missing/odd shapes (returns
 * []); dedupes case-insensitively, keeping the first spelling seen.
 */
export function parseLabels(input: unknown): string[] {
  if (typeof input !== "object" || input === null) return [];
  const o = input as Record<string, unknown>;
  const seen = new Map<string, string>();
  for (const category of Object.keys(LABEL_PREFIX) as LabelCategory[]) {
    for (const key of CATEGORY_KEYS[category]) {
      for (const raw of asStringArray(o[key])) {
        const label = buildLabel(category, raw);
        if (label && !seen.has(label.toLowerCase())) {
          seen.set(label.toLowerCase(), label);
          if (seen.size >= MAX_LABELS_PER_ITEM) return [...seen.values()];
        }
      }
    }
  }
  return [...seen.values()];
}
