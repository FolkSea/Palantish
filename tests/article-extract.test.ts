import { describe, it, expect } from "vitest";
import {
  articleScope,
  isContentImage,
  htmlToArticleMarkdown,
  plainFromMarkdown,
  unwrapLinkedImages,
} from "@/lib/article-extract";

const BASE = "https://example.com/news/story";

describe("articleScope", () => {
  it("picks the richest block, not the first", () => {
    // The Hacker News shape: several teaser <article> cards, the real story in
    // <main>. Taking the first match gives a 20-character promo.
    const html = `
      <body>
        <article>Sponsored teaser</article>
        <article>Another teaser</article>
        <main><p>${"The real story. ".repeat(40)}</p></main>
      </body>`;
    expect(articleScope(html)).toContain("The real story.");
    expect(articleScope(html)).not.toContain("Sponsored teaser");
  });

  it("falls back to the body when there is no article or main", () => {
    const html = "<html><head><title>x</title></head><body><p>Only body</p></body></html>";
    expect(articleScope(html)).toContain("Only body");
    expect(articleScope(html)).not.toContain("<title>");
  });
});

describe("isContentImage", () => {
  it("keeps a plain article illustration", () => {
    expect(isContentImage('<img src="/img/hero.jpg" alt="The hero">', BASE)).toBe(true);
  });

  it("resolves a lazy-loaded source", () => {
    expect(isContentImage('<img data-src="https://cdn.example.com/a.jpg">', BASE)).toBe(
      true,
    );
  });

  it("drops images with nothing to show", () => {
    expect(isContentImage("<img>", BASE)).toBe(false);
    expect(isContentImage('<img src="">', BASE)).toBe(false);
    // An unfilled template placeholder a script would populate later.
    expect(isContentImage('<img src="${pick.i}">', BASE)).toBe(false);
    expect(isContentImage('<img src="{{hero}}">', BASE)).toBe(false);
    expect(isContentImage('<img src="data:image/gif;base64,R0lGOD">', BASE)).toBe(false);
  });

  it("drops advertising by alt text or URL", () => {
    expect(isContentImage('<img src="/x.png" alt="ad">', BASE)).toBe(false);
    expect(isContentImage('<img src="/x.png" alt="Sponsored content">', BASE)).toBe(
      false,
    );
    expect(isContentImage('<img src="https://cdn.example.com/ads/banner.png">', BASE)).toBe(
      false,
    );
  });

  it("drops icons and tracking pixels by their stated size", () => {
    expect(isContentImage('<img src="/i.png" width="16" height="16">', BASE)).toBe(false);
    expect(isContentImage('<img src="/i.png" width="1" height="1">', BASE)).toBe(false);
    expect(isContentImage('<img src="/i.png" width="900" height="470">', BASE)).toBe(true);
  });

  it("drops site chrome by class, which often carries no dimensions", () => {
    // SecurityWeek's author headshots and masthead: same wp-content path as the
    // article image, distinguishable only by class.
    expect(
      isContentImage('<img src="/uploads/2023/10/Author.jpg" class="avatar avatar-150 photo">', BASE),
    ).toBe(false);
    expect(isContentImage('<img src="/uploads/mark.png" class="site-logo">', BASE)).toBe(
      false,
    );
  });
});

describe("htmlToArticleMarkdown", () => {
  it("converts the article to markdown", () => {
    const md = htmlToArticleMarkdown(
      `<article>
         <h1>Headline</h1>
         <p>First paragraph.</p>
         <h2>A section</h2>
         <ul><li>One</li><li>Two</li></ul>
         <blockquote>Quoted line.</blockquote>
         <pre><code>curl https://example.org</code></pre>
       </article>`,
      BASE,
    );
    expect(md).toContain("# Headline");
    expect(md).toContain("## A section");
    expect(md).toContain("First paragraph.");
    expect(md).toContain("- One");
    expect(md).toContain("> Quoted line.");
    expect(md).toContain("```");
  });

  it("removes scripts, styling and site furniture", () => {
    const md = htmlToArticleMarkdown(
      `<article>
         <nav>Home About</nav>
         <script>window.tracker = 1</script>
         <style>.x { color: red }</style>
         <p>${"Body text. ".repeat(20)}</p>
         <aside>You might also like</aside>
         <footer>Copyright</footer>
       </article>`,
      BASE,
    );
    expect(md).toContain("Body text.");
    for (const gone of ["window.tracker", "color: red", "Home About", "might also like", "Copyright"]) {
      expect(md).not.toContain(gone);
    }
  });

  it("strips containers the publisher labels as advertising or recirculation", () => {
    const md = htmlToArticleMarkdown(
      `<article>
         <p>${"Real reporting. ".repeat(20)}</p>
         <div class="ad-slot"><p>Buy this thing</p></div>
         <section id="related-stories"><p>More from us</p></section>
         <div class="newsletter-signup"><p>Subscribe now</p></div>
       </article>`,
      BASE,
    );
    expect(md).toContain("Real reporting.");
    expect(md).not.toContain("Buy this thing");
    expect(md).not.toContain("More from us");
    expect(md).not.toContain("Subscribe now");
  });

  it("keeps the article's own images and drops the rest", () => {
    const md = htmlToArticleMarkdown(
      `<article>
         <img src="/img/hero.jpg" alt="Attack chain">
         <img src="\${pick.i}" alt="ad">
         <img class="avatar" src="/img/author.jpg">
         <img src="/px.gif" width="1" height="1">
         <p>${"Story. ".repeat(40)}</p>
       </article>`,
      BASE,
    );
    const images = md.match(/!\[[^\]]*\]\([^)]*\)/g) ?? [];
    expect(images).toEqual([
      "![Attack chain](https://example.com/img/hero.jpg)",
    ]);
  });

  it("emits an anchor-wrapped image as the image alone", () => {
    // "Click the photo" markup would otherwise nest as [![alt](src)](href),
    // which renders as stray brackets once the image is drawn.
    const md = htmlToArticleMarkdown(
      `<article><a href="/full.jpg"><img src="/img/hero.jpg" alt="Chain"></a>
       <p>${"Story. ".repeat(40)}</p></article>`,
      BASE,
    );
    expect(md).toContain("![Chain](https://example.com/img/hero.jpg)");
    expect(md).not.toContain("[![");
  });

  it("drops an icon sitting beside link text", () => {
    // Unit 42's "Share" and "Read now" controls: an <a> holding a label and a
    // chrome icon. The link is worth keeping; the icon is not.
    const md = htmlToArticleMarkdown(
      `<article><p>x <a href="/post#"><img src="/icons/down.svg" alt="Down arrow">Share</a></p>
       <p>${"Story. ".repeat(40)}</p></article>`,
      BASE,
    );
    expect(md).toContain("[Share](https://example.com/post#)");
    expect(md).not.toContain("down.svg");
  });

  it("keeps links, resolved against the page", () => {
    const md = htmlToArticleMarkdown(
      `<article><p>See <a href="/advisory">the advisory</a> and
       <a href="javascript:void(0)">this</a>.</p></article>`,
      BASE,
    );
    expect(md).toContain("[the advisory](https://example.com/advisory)");
    // A non-http target is not a destination; the text survives without a link.
    expect(md).toContain("this");
    expect(md).not.toContain("javascript:");
  });

  it("decodes entities and tidies whitespace", () => {
    const md = htmlToArticleMarkdown(
      "<article><p>Ivanti&nbsp;&amp; Fortinet &mdash; both&#46;</p>\n\n\n<p>Next.</p></article>",
      BASE,
    );
    expect(md).toContain("Ivanti & Fortinet - both.");
    expect(md).not.toMatch(/\n{3,}/);
  });
});

describe("plainFromMarkdown", () => {
  it("keeps the prose and drops link and image targets", () => {
    // Reader-recovered bodies are markdown; their link targets are the site's
    // own navigation and asset URLs, which must not become URI indicators.
    const plain = plainFromMarkdown(
      "![hero](https://eu-images.contentstack.com/v3/assets/blt6d90.jpg)\n" +
        "CISA [updated a warning](https://www.darkreading.com/ics-ot) about PLCs.",
    );
    expect(plain).toContain("CISA updated a warning about PLCs.");
    expect(plain).not.toContain("contentstack.com");
    expect(plain).not.toContain("darkreading.com");
  });

  it("leaves a bare URL in the prose alone, so real IOCs survive", () => {
    const plain = plainFromMarkdown("C2 at https://evil.example.org/panel was seen.");
    expect(plain).toContain("https://evil.example.org/panel");
  });
});

describe("unwrapLinkedImages", () => {
  it("keeps the illustration when the link is only the image", () => {
    // The "click the photo" pattern; left as-is the renderer draws the image
    // and leaves the brackets and URL as literal text.
    expect(
      unwrapLinkedImages("[![Attack chain](https://x.test/a.png)](https://x.test/full)"),
    ).toBe("![Attack chain](https://x.test/a.png)");
  });

  it("drops an icon inside a link label and keeps the link", () => {
    // Unit 42's share and read-more controls, as the reader proxy emits them.
    expect(
      unwrapLinkedImages(
        "[Share ![Down arrow](https://x.test/icons/down.svg)](https://x.test/post/#)",
      ),
    ).toBe("[Share](https://x.test/post/#)");
    expect(
      unwrapLinkedImages(
        "[Read now ![Right arrow](https://x.test/icons/right.svg)](https://x.test/next)",
      ),
    ).toBe("[Read now](https://x.test/next)");
  });

  it("leaves ordinary links and images alone", () => {
    const md = "See [the advisory](https://x.test/a) and ![hero](https://x.test/h.png).";
    expect(unwrapLinkedImages(md)).toBe(md);
  });
});
