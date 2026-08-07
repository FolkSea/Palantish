import { describe, it, expect } from "vitest";
import {
  matchRanges,
  searchPattern,
  splitOnMatches,
  stepHit,
} from "@/lib/text-search";

/** The matched substrings, which is what the reader sees highlighted. */
function hits(text: string, query: string): string[] {
  return matchRanges(text, query).map((r) => text.slice(r.start, r.end));
}

describe("searchPattern", () => {
  it("returns nothing for an empty query", () => {
    for (const q of ["", "   ", null as unknown as string])
      expect(searchPattern(q)).toBeNull();
  });
});

describe("plain matching", () => {
  it("is case insensitive", () => {
    expect(hits("Cozy Bear and COZY BEAR", "cozy bear")).toEqual([
      "Cozy Bear",
      "COZY BEAR",
    ]);
  });

  it("finds every occurrence, in order", () => {
    expect(matchRanges("aa bb aa", "aa")).toEqual([
      { start: 0, end: 2 },
      { start: 6, end: 8 },
    ]);
  });

  it("treats regex characters in the query as literal text", () => {
    expect(hits("cost is 5 (approx)", "(approx)")).toEqual(["(approx)"]);
    expect(hits("a+b and axb", "a+b")).toEqual(["a+b"]);
  });

  // The reading view rewraps paragraphs, so a copied phrase can straddle a
  // break that was not there in the source.
  it("matches a phrase across a line break", () => {
    expect(hits("the Cozy\nBear campaign", "Cozy Bear")).toEqual(["Cozy\nBear"]);
  });
});

describe("defanged indicators", () => {
  it("finds a defanged IP from the fanged query", () => {
    expect(hits("beacons to 185.220.101[.]4 daily", "185.220.101.4")).toEqual([
      "185.220.101[.]4",
    ]);
  });

  it("finds a defanged domain from the fanged query", () => {
    for (const written of [
      "evil[.]com",
      "evil(.)com",
      "evil{.}com",
      "evil[dot]com",
      "evil(dot)com",
    ]) {
      expect(hits(`hosted at ${written} today`, "evil.com")).toEqual([written]);
    }
  });

  it("finds a defanged URL, however the scheme was broken", () => {
    for (const written of [
      "hxxp://evil.com/a",
      "hxxp[://]evil.com/a",
      "hxxp[:]//evil.com/a",
      "http[://]evil.com/a",
    ]) {
      expect(hits(`see ${written} for the payload`, "http://evil.com/a")).toEqual([
        written,
      ]);
    }
  });

  it("finds a defanged email address", () => {
    expect(hits("mail to a[@]evil[.]com now", "a@evil.com")).toEqual([
      "a[@]evil[.]com",
    ]);
  });

  // The other direction: what the analyst pasted may itself be defanged.
  it("finds the plain form from a defanged query", () => {
    expect(hits("beacons to 185.220.101.4", "185.220.101[.]4")).toEqual([
      "185.220.101.4",
    ]);
    expect(hits("see http://evil.com now", "hxxp[://]evil[.]com")).toEqual([
      "http://evil.com",
    ]);
  });

  it("finds both forms in one report", () => {
    const text = "evil.com resolved; the report writes it evil[.]com elsewhere";
    expect(hits(text, "evil.com")).toEqual(["evil.com", "evil[.]com"]);
  });

  // A dot is a dot, not "any character" - the whole point of escaping it.
  it("does not let the query's dot match an arbitrary character", () => {
    expect(hits("evilxcom", "evil.com")).toEqual([]);
  });
});

describe("stepHit", () => {
  it("wraps at both ends", () => {
    expect(stepHit(0, 3, 1)).toBe(1);
    expect(stepHit(2, 3, 1)).toBe(0);
    expect(stepHit(0, 3, -1)).toBe(2);
  });

  it("stays at zero when there is nothing to step through", () => {
    expect(stepHit(0, 0, 1)).toBe(0);
    expect(stepHit(0, 0, -1)).toBe(0);
  });
});

describe("splitOnMatches", () => {
  it("alternates plain and matching runs, in reading order", () => {
    expect(splitOnMatches("see evil.com now", "evil.com")).toEqual([
      { text: "see ", hit: false },
      { text: "evil.com", hit: true },
      { text: " now", hit: false },
    ]);
  });

  // Concatenating the segments has to give the text back, or the renderer
  // would silently drop or duplicate part of the report.
  it("preserves the text exactly", () => {
    const text = "a evil.com b evil[.]com c";
    const joined = splitOnMatches(text, "evil.com")
      .map((s) => s.text)
      .join("");
    expect(joined).toBe(text);
  });

  it("marks every occurrence, so hit numbering follows the document", () => {
    const segments = splitOnMatches("x 1.1.1.1 y 1.1.1[.]1 z", "1.1.1.1");
    expect(segments.filter((s) => s.hit).map((s) => s.text)).toEqual([
      "1.1.1.1",
      "1.1.1[.]1",
    ]);
  });

  it("handles a match at each end", () => {
    expect(splitOnMatches("aXa", "a")).toEqual([
      { text: "a", hit: true },
      { text: "X", hit: false },
      { text: "a", hit: true },
    ]);
  });

  it("returns the text untouched when nothing matches", () => {
    expect(splitOnMatches("nothing here", "evil.com")).toEqual([
      { text: "nothing here", hit: false },
    ]);
    expect(splitOnMatches("", "evil.com")).toEqual([]);
  });
});
