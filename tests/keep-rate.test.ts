import { describe, it, expect } from "vitest";
import { keepShade } from "@/lib/keep-rate";

/** The hue out of an hsl() string, for asserting green-ness. */
function hueOf(css: string | null): number | null {
  const m = css?.match(/hsl\((\d+)/);
  return m ? Number(m[1]) : null;
}
function alphaOf(css: string | null): number | null {
  const m = css?.match(/\/ ([\d.]+)\)/);
  return m ? Number(m[1]) : null;
}

describe("keepShade", () => {
  it("says nothing about a feed that has produced nothing", () => {
    expect(keepShade(0, 0)).toEqual({ background: null, keptPercent: null });
  });

  it("runs green when most is kept and red when most is dropped", () => {
    const good = hueOf(keepShade(100, 0).background)!;
    const bad = hueOf(keepShade(0, 100).background)!;
    expect(good).toBeGreaterThan(120); // green end
    expect(bad).toBeLessThan(20); // red end
    expect(good).toBeGreaterThan(bad);
  });

  it("moves monotonically from red to green as the keep rate rises", () => {
    const hues = [0, 25, 50, 75, 100].map(
      (k) => hueOf(keepShade(k, 100 - k).background)!,
    );
    for (let i = 1; i < hues.length; i++) {
      expect(hues[i]).toBeGreaterThan(hues[i - 1]);
    }
  });

  it("puts an even split in the middle, not at either end", () => {
    const mid = hueOf(keepShade(50, 50).background)!;
    expect(mid).toBeGreaterThan(50);
    expect(mid).toBeLessThan(90);
  });

  it("reports the percentage kept, rounded", () => {
    expect(keepShade(1, 2).keptPercent).toBe(33);
    expect(keepShade(80, 20).keptPercent).toBe(80);
  });

  it("fades the tint in with sample size", () => {
    // One dropped item out of one should not paint a feed alarming red: at tiny
    // totals a single drop swings the ratio completely.
    const tiny = alphaOf(keepShade(0, 1).background)!;
    const solid = alphaOf(keepShade(0, 100).background)!;
    expect(tiny).toBeLessThan(0.5);
    expect(solid).toBe(1);
    expect(tiny).toBeLessThan(alphaOf(keepShade(0, 3).background)!);
  });

  it("reaches full strength once there is enough evidence", () => {
    // Feeds in single figures are common here, so the threshold has to be low
    // enough that they still read at a glance.
    expect(alphaOf(keepShade(3, 2).background)).toBe(1);
    expect(alphaOf(keepShade(10, 10).background)).toBe(1);
  });
});
