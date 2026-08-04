// Shading for a feed's keep/drop ratio: green when most of what it publishes is
// kept, red when most is dropped.
//
// Pure, so the colour can be tested without rendering anything.

export type KeepShade = {
  /** CSS colour for the cell background, or null when there is nothing to say. */
  background: string | null;
  /** 0-100, or null when the feed has produced nothing yet. */
  keptPercent: number | null;
};

// Interpolating hue alone: 140 is a green, 0 is a red, and everything between
// is the amber the eye expects in the middle. Kept pale so the numbers on top
// stay legible - this is a background tint, not a status light.
const GREEN_HUE = 140;
const SATURATION = 65;
const LIGHTNESS = 86;

/**
 * At tiny totals a single drop swings the ratio completely, so the tint fades in
 * with sample size and a brand new feed reads as "no strong signal" rather than
 * alarming red on its first dropped item.
 *
 * Deliberately low: set at 20 first, which washed out most of this corpus,
 * where plenty of real feeds sit in single figures. Five is enough to stop one
 * item shouting without muting everything else.
 */
const CONFIDENT_TOTAL = 5;

export function keepShade(kept: number, dropped: number): KeepShade {
  const total = kept + dropped;
  if (total <= 0) return { background: null, keptPercent: null };

  const keptRatio = kept / total;
  const keptPercent = Math.round(keptRatio * 100);
  const hue = Math.round(GREEN_HUE * keptRatio);
  // Alpha, not lightness: it blends with whatever the row background is, so a
  // faint tint stays faint on a striped or hovered row.
  const strength = Math.min(1, total / CONFIDENT_TOTAL);
  const alpha = Math.round(strength * 100) / 100;

  return {
    background: `hsl(${hue} ${SATURATION}% ${LIGHTNESS}% / ${alpha})`,
    keptPercent,
  };
}
