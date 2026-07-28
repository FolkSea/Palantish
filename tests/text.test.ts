import { describe, it, expect } from "vitest";
import { toAscii } from "@/lib/text";

describe("toAscii", () => {
  it("decodes numeric HTML entities", () => {
    expect(toAscii("Origin &#8211; data breach")).toBe("Origin - data breach");
    expect(toAscii("company&#8217;s data")).toBe("company's data");
    expect(toAscii("A &#8212; B")).toBe("A -- B");
  });

  it("decodes named and hex entities", () => {
    expect(toAscii("R&amp;D &lt;tag&gt; &hellip;")).toBe("R&D <tag> ...");
    expect(toAscii("quote &#x2019;s")).toBe("quote 's");
  });

  it("handles double-encoded entities", () => {
    expect(toAscii("A &amp;#8211; B")).toBe("A - B");
  });

  it("transliterates smart punctuation and strips emoji", () => {
    expect(toAscii("“hello” — world…")).toBe(
      '"hello" -- world...',
    );
    expect(toAscii("launch 🚀 now")).toBe("launch now");
  });

  it("strips accents to base letters", () => {
    expect(toAscii("Café naïve")).toBe("Cafe naive");
  });

  it("collapses whitespace by default but keeps newlines when asked", () => {
    expect(toAscii("a\n\n  b")).toBe("a b");
    expect(toAscii("a\n\nb", true)).toBe("a\n\nb");
  });

  it("returns empty string for nullish input", () => {
    expect(toAscii(null)).toBe("");
    expect(toAscii(undefined)).toBe("");
  });
});
