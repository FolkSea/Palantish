import { describe, it, expect } from "vitest";
import {
  htmlToMarkdown,
  absoluteUrl,
  decodeEntities,
  worthConverting,
} from "@/lib/html-to-markdown";

const BASE = "https://vendor.example/blog/report";

describe("htmlToMarkdown", () => {
  // The whole point: an article copied out of a browser keeps its images.
  it("keeps an image as markdown", () => {
    const { markdown } = htmlToMarkdown(
      '<p>Infrastructure:</p><img src="https://vendor.example/i/c2.png" alt="C2 panel">',
    );
    expect(markdown).toContain("![C2 panel](https://vendor.example/i/c2.png)");
  });

  // Copied markup is full of relative paths; the page they came from resolved
  // them and the paste box is not that page.
  it("resolves a relative image against the report URL", () => {
    const { markdown } = htmlToMarkdown('<img src="/i/flow.png" alt="Flow">', BASE);
    expect(markdown).toContain("![Flow](https://vendor.example/i/flow.png)");
  });

  it("reports an image it could not carry, rather than dropping it silently", () => {
    const { markdown, dropped } = htmlToMarkdown(
      '<img src="data:image/png;base64,iVBORw0KGgo=" alt="Screenshot">',
    );
    expect(markdown).toBe("");
    expect(dropped).toEqual([{ reason: "not_on_the_web", alt: "Screenshot" }]);
  });

  it("carries headings, lists and emphasis", () => {
    const { markdown } = htmlToMarkdown(
      "<h2>Findings</h2><ul><li>First</li><li>Second</li></ul>" +
        "<p>The actor used <strong>Cobalt Strike</strong> and <em>rundll32</em>.</p>",
    );
    expect(markdown).toContain("## Findings");
    expect(markdown).toContain("- First\n- Second");
    expect(markdown).toContain("**Cobalt Strike**");
    expect(markdown).toContain("*rundll32*");
  });

  it("numbers an ordered list", () => {
    const { markdown } = htmlToMarkdown("<ol><li>One</li><li>Two</li></ol>");
    expect(markdown).toBe("1. One\n2. Two");
  });

  it("keeps a link and drops the brackets when there is nothing to link to", () => {
    const { markdown } = htmlToMarkdown(
      '<p>See <a href="https://vendor.example/x">the analysis</a> and <a>this</a>.</p>',
    );
    expect(markdown).toContain("[the analysis](https://vendor.example/x)");
    // No stray bracket where the unusable link was.
    expect(markdown).toContain("and this.");
  });

  // A copied page brings its navigation, tracking and stylesheets with it.
  it("throws away script and style content", () => {
    const { markdown } = htmlToMarkdown(
      "<style>.a{color:red}</style><script>alert(1)</script><p>Body text</p>",
    );
    expect(markdown).toBe("Body text");
  });

  // An unknown wrapper must cost formatting, never words.
  it("keeps the text inside markup it does not know", () => {
    const { markdown } = htmlToMarkdown("<figure><figcaption>Caption</figcaption></figure>");
    expect(markdown).toContain("Caption");
  });

  // Faithfully, including the punctuation that is not ASCII: flattening that
  // is toAscii's job, at the point the text is stored.
  it("decodes the entities a browser writes", () => {
    const { markdown } = htmlToMarkdown("<p>Sandbox &amp; C2 &#8212; &quot;quoted&quot;</p>");
    expect(markdown).toBe(`Sandbox & C2 ${String.fromCharCode(0x2014)} "quoted"`);
  });

  it("does not leave a page of blank lines behind empty wrappers", () => {
    const { markdown } = htmlToMarkdown(
      "<div></div><div><p></p></div><p>Only line</p><div></div>",
    );
    expect(markdown).toBe("Only line");
  });
});

describe("absoluteUrl", () => {
  it("refuses anything that is not http(s)", () => {
    expect(absoluteUrl("javascript:alert(1)")).toBeNull();
    expect(absoluteUrl("data:text/html,<b>x</b>")).toBeNull();
    expect(absoluteUrl("file:///etc/passwd")).toBeNull();
  });

  it("keeps an absolute web URL as it is", () => {
    expect(absoluteUrl("https://a.example/b?c=1")).toBe("https://a.example/b?c=1");
  });
});

describe("decodeEntities", () => {
  it("handles named, decimal and hex forms", () => {
    expect(decodeEntities("&lt;a&gt; &#65; &#x42;")).toBe("<a> A B");
  });

  it("leaves an entity it does not know alone", () => {
    expect(decodeEntities("&notarealentity;")).toBe("&notarealentity;");
  });
});

describe("worthConverting", () => {
  // Copying inside a plain text field still puts a scrap of HTML on the
  // clipboard; converting that would add noise and lose nothing.
  it("is false for markup with no structure in it", () => {
    expect(worthConverting("<span>plain</span>")).toBe(false);
    expect(worthConverting("")).toBe(false);
  });

  it("is true once there is an article in it", () => {
    expect(worthConverting("<p>Body</p>")).toBe(true);
    expect(worthConverting('<img src="https://a.example/x.png">')).toBe(true);
  });
});
