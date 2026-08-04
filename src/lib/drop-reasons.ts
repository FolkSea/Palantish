// Bucketing the free-text drop reason into something a pie chart can show.
//
// The stored reason is part fixed vocabulary and part model prose - "LLM: not
// intelligence" alongside a sentence explaining why one particular post was
// vendor marketing. Charting the raw strings would give one slice per drop, so
// they are grouped by what actually decided it.
//
// Pure, so the grouping is testable without a database.

export type DropCategory =
  | "not_intelligence"
  | "marketing"
  | "low_signal"
  | "incomplete"
  | "screened"
  | "other";

export const DROP_CATEGORY_LABEL: Record<DropCategory, string> = {
  not_intelligence: "Not intelligence",
  marketing: "Marketing / product",
  low_signal: "Low-signal crew mention",
  incomplete: "Missing title or URL",
  screened: "Screened out (other)",
  other: "Unrecorded",
};

// Distinguishable at pie-slice size, and matching the app's palette: the
// benign/expected reasons sit in the cooler end, the judgement calls warmer.
export const DROP_CATEGORY_COLOR: Record<DropCategory, string> = {
  not_intelligence: "#2855D9",
  marketing: "#0d9488",
  low_signal: "#f59e0b",
  incomplete: "#94a3b8",
  screened: "#7c3aed",
  other: "#cbd5e1",
};

/** The order slices are shown in - biggest causes first, "Unrecorded" last. */
export const DROP_CATEGORY_ORDER: DropCategory[] = [
  "not_intelligence",
  "marketing",
  "low_signal",
  "screened",
  "incomplete",
  "other",
];

/**
 * Which bucket a stored reason belongs to.
 *
 * Order matters: the specific pre-gate reasons are checked before the generic
 * "LLM:" prefix, because a model sentence can mention marketing while the drop
 * was decided on something else.
 */
export function dropReasonCategory(reason: string | null): DropCategory {
  const r = (reason ?? "").trim().toLowerCase();
  if (!r) return "other";
  if (r.includes("missing title or url")) return "incomplete";
  if (r.startsWith("marketing") || r.includes("marketing / product")) {
    return "marketing";
  }
  if (r.includes("low-signal crew mention")) return "low_signal";
  // The catch-all the LLM gate uses when a post is simply not reporting.
  if (r === "llm: not intelligence" || r.endsWith("not intelligence")) {
    return "not_intelligence";
  }
  // Anything else the model explained in its own words.
  if (r.startsWith("llm:") || r.startsWith("screened out")) return "screened";
  return "other";
}

export type DropBreakdown = {
  category: DropCategory;
  label: string;
  color: string;
  count: number;
};

/** Counts per category, in display order, omitting categories with none. */
export function summariseDropReasons(
  reasons: (string | null)[],
): DropBreakdown[] {
  const counts = new Map<DropCategory, number>();
  for (const r of reasons) {
    const c = dropReasonCategory(r);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return DROP_CATEGORY_ORDER.filter((c) => (counts.get(c) ?? 0) > 0).map((c) => ({
    category: c,
    label: DROP_CATEGORY_LABEL[c],
    color: DROP_CATEGORY_COLOR[c],
    count: counts.get(c) ?? 0,
  }));
}
