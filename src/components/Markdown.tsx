import { type ReactNode } from "react";
import { splitOnMatches } from "@/lib/text-search";

/**
 * A find-in-report highlight: what to look for, and which hit is the one the
 * reader is standing on.
 *
 * The renderer numbers the hits as it walks the document, so the numbering is
 * reading order and the count is exactly what ends up on the page - there is no
 * second pass over the text that could disagree with what is drawn.
 */
export type Highlight = { query: string; active: number };

// Mutable across one render pass: the hit index shared by every text node.
type HitCounter = { n: number };

/**
 * Wrap each match in the string, numbering it. Anything not matched is returned
 * as-is so an unsearched document renders exactly as it did before.
 */
function highlighted(
  text: string,
  keyBase: string,
  h: Highlight | undefined,
  counter: HitCounter,
): ReactNode {
  if (!h?.query || !text) return text;
  const segments = splitOnMatches(text, h.query);
  if (!segments.some((seg) => seg.hit)) return text;

  return (
    <>
      {segments.map((seg, j) => {
        if (!seg.hit) return seg.text;
        const index = counter.n++;
        const active = index === h.active;
        return (
          <mark
            key={`${keyBase}-h${j}`}
            data-hit={index}
            data-active={active ? "true" : undefined}
            className={
              active
                ? "rounded-sm bg-amber-400 text-slate-900"
                : "rounded-sm bg-amber-200/70 text-slate-900"
            }
          >
            {seg.text}
          </mark>
        );
      })}
    </>
  );
}

/**
 * Minimal, dependency-free markdown renderer for analyst notes. Renders to React
 * elements (text is never injected as raw HTML), covering the common cases:
 * headings (#..###), unordered/ordered lists, blockquotes, paragraphs, and the
 * inline styles **bold**, *italic* / _italic_, `code`, [links](https://...) and
 * ![images](https://...).
 */
export function Markdown({
  text,
  highlight,
}: {
  text: string;
  /** Optional find-in-report state; omitted, nothing is highlighted. */
  highlight?: Highlight;
}) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  // One counter for the whole document, so hit 4 is the fourth hit a reader
  // scrolling from the top would come to.
  const counter: HitCounter = { n: 0 };
  const blocks: ReactNode[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    const k = `b${blocks.length}`;
    blocks.push(
      <p key={k} className="leading-relaxed text-slate-700">
        {renderInline(para.join(" "), k, highlight, counter)}
      </p>,
    );
    para = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      const level = heading[1].length;
      // Sized in em, not px: the container sets the base and the hierarchy
      // scales with it (see lib/reading-prefs).
      const cls =
        level === 1
          ? "font-semibold text-slate-900"
          : level === 2
            ? "font-semibold text-slate-900"
            : "font-semibold text-slate-700";
      const em = level === 1 ? "1.5em" : level === 2 ? "1.25em" : "1.1em";
      const k = `b${blocks.length}`;
      blocks.push(
        <p key={k} className={cls} style={{ fontSize: em }}>
          {renderInline(heading[2], k, highlight, counter)}
        </p>,
      );
      i += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      flushPara();
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (
        i < lines.length &&
        (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))
      ) {
        items.push(lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, ""));
        i += 1;
      }
      const k = `b${blocks.length}`;
      const li = items.map((it, j) => (
        <li key={`${k}-${j}`}>{renderInline(it, `${k}-${j}`, highlight, counter)}</li>
      ));
      blocks.push(
        ordered ? (
          <ol key={k} className="list-decimal space-y-0.5 pl-5 text-slate-700">
            {li}
          </ol>
        ) : (
          <ul key={k} className="list-disc space-y-0.5 pl-5 text-slate-700">
            {li}
          </ul>
        ),
      );
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      const k = `b${blocks.length}`;
      blocks.push(
        <blockquote
          key={k}
          className="border-l-2 border-slate-300 pl-3 text-slate-600 italic"
        >
          {renderInline(quote.join(" "), k, highlight, counter)}
        </blockquote>,
      );
      continue;
    }

    if (line.trim() === "") {
      flushPara();
      i += 1;
      continue;
    }

    para.push(line.trim());
    i += 1;
  }
  flushPara();

  return <div className="space-y-2">{blocks}</div>;
}

// Images come first so "![alt](url)" is not consumed by the link alternative,
// which would leave a stray "!" and render the alt text as a hyperlink.
const INLINE_RE =
  /(!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(_([^_]+)_)|(`([^`]+)`)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;

function renderInline(
  text: string,
  keyBase: string,
  h?: Highlight,
  counter: HitCounter = { n: 0 },
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let idx = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last)
      nodes.push(highlighted(text.slice(last, m.index), `${keyBase}-t${idx}`, h, counter));
    const key = `${keyBase}-i${idx}`;
    if (m[1])
      nodes.push(
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={key}
          src={m[3]}
          alt={m[2] ?? ""}
          className="my-2 max-w-full rounded border border-[#e5e7eb]"
          loading="lazy"
          referrerPolicy="no-referrer"
        />,
      );
    else if (m[5])
      nodes.push(<strong key={key}>{highlighted(m[5], key, h, counter)}</strong>);
    else if (m[7]) nodes.push(<em key={key}>{highlighted(m[7], key, h, counter)}</em>);
    else if (m[9]) nodes.push(<em key={key}>{highlighted(m[9], key, h, counter)}</em>);
    else if (m[11])
      nodes.push(
        <code
          key={key}
          className="rounded bg-slate-200 px-1 py-0.5 font-mono"
          style={{ fontSize: "0.85em" }}
        >
          {highlighted(m[11], key, h, counter)}
        </code>,
      );
    else if (m[13])
      nodes.push(
        <a
          key={key}
          href={m[14]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#1d4ed8] hover:underline"
        >
          {highlighted(m[13], key, h, counter)}
        </a>,
      );
    last = m.index + m[0].length;
    idx += 1;
  }
  if (last < text.length)
    nodes.push(highlighted(text.slice(last), `${keyBase}-t${idx}`, h, counter));
  return nodes;
}
