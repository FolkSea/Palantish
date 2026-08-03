import { describe, it, expect } from "vitest";
import {
  DEFAULT_READING_PREFS,
  READING_FONTS,
  READING_SIZES,
  fontStack,
  readingPrefsFrom,
  readingStyle,
} from "@/lib/reading-prefs";

describe("readingPrefsFrom", () => {
  it("reads a stored preference", () => {
    expect(readingPrefsFrom({ reading: { font: "serif", size: 18 } })).toEqual({
      font: "serif",
      size: 18,
    });
  });

  it("defaults when nothing is stored", () => {
    expect(readingPrefsFrom(undefined)).toEqual(DEFAULT_READING_PREFS);
    expect(readingPrefsFrom(null)).toEqual(DEFAULT_READING_PREFS);
    expect(readingPrefsFrom({})).toEqual(DEFAULT_READING_PREFS);
    // Other metadata on the same user is not a reading preference.
    expect(readingPrefsFrom({ focus: "ecrime" })).toEqual(DEFAULT_READING_PREFS);
  });

  it("falls back per field, so one bad value does not lose the other", () => {
    expect(readingPrefsFrom({ reading: { font: "comic", size: 18 } })).toEqual({
      font: DEFAULT_READING_PREFS.font,
      size: 18,
    });
    expect(readingPrefsFrom({ reading: { font: "serif", size: "huge" } })).toEqual({
      font: "serif",
      size: DEFAULT_READING_PREFS.size,
    });
  });

  it("refuses a size that would make the pane unreadable", () => {
    for (const size of [0, -14, 4, 400, Number.NaN, Infinity]) {
      expect(readingPrefsFrom({ reading: { font: "sans", size } }).size).toBe(
        DEFAULT_READING_PREFS.size,
      );
    }
  });

  it("rounds a fractional size", () => {
    expect(readingPrefsFrom({ reading: { size: 15.6 } }).size).toBe(16);
  });
});

describe("readingStyle", () => {
  it("gives the container a font and a base size", () => {
    const style = readingStyle({ font: "serif", size: 18 });
    expect(style.fontSize).toBe("18px");
    expect(style.fontFamily).toContain("Georgia");
  });

  it("covers every offered font", () => {
    for (const f of READING_FONTS) {
      expect(fontStack(f.value), f.value).toBe(f.stack);
      expect(fontStack(f.value).length).toBeGreaterThan(0);
    }
  });

  it("every offered size is one the reader is allowed to keep", () => {
    // A size in the dropdown that readingPrefsFrom rejects would silently snap
    // back to the default after saving.
    for (const s of READING_SIZES) {
      expect(
        readingPrefsFrom({ reading: { font: "sans", size: s.value } }).size,
        s.label,
      ).toBe(s.value);
    }
  });

  it("offers the default size as a choice", () => {
    expect(READING_SIZES.map((s) => s.value)).toContain(DEFAULT_READING_PREFS.size);
  });
});
