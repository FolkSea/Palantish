import { describe, it, expect } from "vitest";
import { iconKeyFor, iconDataUri, iconFor } from "@/lib/graph/icons";
import { GRAPH_NODE_TYPES, IOC_SUBTYPES } from "@/lib/graph/types";

describe("iconKeyFor", () => {
  it("gives each IOC subtype its own key", () => {
    for (const st of IOC_SUBTYPES) {
      expect(iconKeyFor("ioc", st)).toBe(st);
    }
  });

  it("uses the type itself for everything that is not an IOC", () => {
    for (const t of GRAPH_NODE_TYPES) {
      if (t === "ioc") continue;
      expect(iconKeyFor(t)).toBe(t);
    }
  });

  it("falls back rather than leaving a node blank", () => {
    // An ioc_type this build has not seen still has to draw something.
    expect(iconKeyFor("ioc", "asn")).toBe("uri");
    expect(iconKeyFor("ioc", null)).toBe("uri");
    expect(iconKeyFor("ioc")).toBe("uri");
  });
});

describe("iconDataUri", () => {
  it("is a usable inline SVG", () => {
    const uri = iconDataUri("ip");
    expect(uri.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    const svg = decodeURIComponent(uri.slice("data:image/svg+xml;utf8,".length));
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('stroke="white"');
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("encodes the characters that would break a css url()", () => {
    // Raw '#' or '"' in a data URI truncates the value; both must survive.
    for (const t of GRAPH_NODE_TYPES) {
      const uri = iconFor(t, "ip");
      expect(uri).not.toContain("#");
      expect(uri).not.toContain('"');
      expect(uri).not.toContain(" ");
    }
  });
});

describe("the icon set as a whole", () => {
  it("draws a different glyph for every kind of node", () => {
    // The point of the icons is telling node kinds apart, so two kinds sharing
    // one glyph is a defect even though nothing would visibly break.
    const uris = [
      ...IOC_SUBTYPES.map((st) => iconFor("ioc", st)),
      ...GRAPH_NODE_TYPES.filter((t) => t !== "ioc").map((t) => iconFor(t)),
    ];
    expect(new Set(uris).size).toBe(uris.length);
  });

  it("gives an IP and a domain distinctly different glyphs", () => {
    expect(iconFor("ioc", "ip")).not.toBe(iconFor("ioc", "domain"));
  });
});
