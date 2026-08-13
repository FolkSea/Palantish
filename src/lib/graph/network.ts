// Drawing the report network.
//
// The collapsing itself - every indicator two reports share, counted into one
// weighted connection - is done by the report_network database function, so
// the thousands of link rows behind a few hundred connections never leave the
// database. What is left here is how the result is drawn.

/**
 * Stroke width for a connection of the given strength, against the strongest in
 * the graph. Scaled by square root: strengths span orders of magnitude (two
 * reports on the same campaign share hundreds of indicators, most pairs share
 * one), and a linear scale would render everything except the top pair as a
 * hairline.
 */
export function edgeWidth(weight: number, max: number): number {
  const MIN = 1;
  const MAX = 8;
  if (max <= 1) return MIN;
  const t = Math.sqrt(Math.max(1, weight) - 1) / Math.sqrt(max - 1);
  return MIN + t * (MAX - MIN);
}
