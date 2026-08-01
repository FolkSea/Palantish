import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "@/components/Markdown";

const html = (text: string) =>
  renderToStaticMarkup(createElement(Markdown, { text }));

describe("Markdown (reader-recovered articles)", () => {
  it("renders an image rather than a broken link", () => {
    const out = html("![Aerial view](https://cdn.example/water.jpg)");
    expect(out).toContain("<img");
    expect(out).toContain("https://cdn.example/water.jpg");
    expect(out).toContain('alt="Aerial view"');
    // The link alternative must not consume it and leave a stray "!".
    expect(out).not.toContain(">!");
  });

  it("still renders ordinary links", () => {
    const out = html("See [the advisory](https://example.com/a) for detail.");
    expect(out).toContain('href="https://example.com/a"');
    expect(out).toContain("the advisory");
  });

  it("renders headings and keeps paragraphs separate", () => {
    const out = html("## All Signs Point to Iran\n\nFirst para.\n\nSecond para.");
    expect(out).toContain("All Signs Point to Iran");
    expect(out).not.toContain("## ");
    expect((out.match(/<p/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("leaves plain scraped text as readable paragraphs", () => {
    const out = html("Just some scraped prose.\n\nAnd a second block.");
    expect(out).toContain("Just some scraped prose.");
    expect(out).toContain("And a second block.");
  });
});
