// How a reader wants the article pane to look. Stored on the Supabase auth user
// (user_metadata), like the dashboard focus - a per-account display preference
// with no reason to live in a table of its own.

export type ReadingFont = "sans" | "serif" | "mono";

export type ReadingPrefs = {
  font: ReadingFont;
  /** Base size in px. Headings are relative to it, so this scales everything. */
  size: number;
};

export const DEFAULT_READING_PREFS: ReadingPrefs = { font: "sans", size: 14 };

export const READING_FONTS: { value: ReadingFont; label: string; stack: string }[] = [
  {
    value: "sans",
    label: "Sans serif",
    stack:
      'var(--font-inter), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  {
    value: "serif",
    label: "Serif",
    // Long-form reading is what a serif is for, and most of this pane is prose.
    stack: 'Georgia, Cambria, "Times New Roman", Times, serif',
  },
  {
    value: "mono",
    label: "Monospace",
    stack:
      'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  },
];

export const READING_SIZES: { value: number; label: string }[] = [
  { value: 12, label: "Small" },
  { value: 14, label: "Default" },
  { value: 16, label: "Comfortable" },
  { value: 18, label: "Large" },
  { value: 21, label: "Largest" },
];

const MIN_SIZE = 10;
const MAX_SIZE = 32;

function isFont(value: unknown): value is ReadingFont {
  return value === "sans" || value === "serif" || value === "mono";
}

/**
 * Read the preference off whatever `user_metadata` holds. Anything missing or
 * unrecognised falls back to the default, because a stored value that no longer
 * makes sense must not leave the pane unreadable.
 */
export function readingPrefsFrom(
  metadata: Record<string, unknown> | null | undefined,
): ReadingPrefs {
  const raw = metadata?.reading as Partial<ReadingPrefs> | undefined;
  const size = Number(raw?.size);
  return {
    font: isFont(raw?.font) ? raw.font : DEFAULT_READING_PREFS.font,
    size:
      Number.isFinite(size) && size >= MIN_SIZE && size <= MAX_SIZE
        ? Math.round(size)
        : DEFAULT_READING_PREFS.size,
  };
}

/** The font stack for a choice. */
export function fontStack(font: ReadingFont): string {
  return (
    READING_FONTS.find((f) => f.value === font)?.stack ?? READING_FONTS[0].stack
  );
}

/**
 * The style for the article container. Everything inside sizes itself in `em`,
 * so setting the base here scales headings, quotes and code along with the body
 * rather than leaving them fixed while the prose grows.
 */
export function readingStyle(prefs: ReadingPrefs): {
  fontFamily: string;
  fontSize: string;
} {
  return { fontFamily: fontStack(prefs.font), fontSize: `${prefs.size}px` };
}
