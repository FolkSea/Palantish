import { type ReactNode } from "react";

/**
 * Minimal, dependency-free markdown renderer for analyst notes. Renders to React
 * elements (text is never injected as raw HTML), covering the common cases:
 * headings (#..###), unordered/ordered lists, blockquotes, paragraphs, and the
 * inline styles **bold**, *italic* / _italic_, `code`, and [links](https://...).
 */
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    const k = `b${blocks.length}`;
    blocks.push(
      <p key={k} className="leading-relaxed text-slate-700">
        {renderInline(para.join(" "), k)}
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
      const cls =
        level === 1
          ? "text-[14px] font-semibold text-slate-900"
          : level === 2
            ? "text-[13px] font-semibold text-slate-900"
            : "text-[12px] font-semibold text-slate-700";
      const k = `b${blocks.length}`;
      blocks.push(
        <p key={k} className={cls}>
          {renderInline(heading[2], k)}
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
        <li key={`${k}-${j}`}>{renderInline(it, `${k}-${j}`)}</li>
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
          {renderInline(quote.join(" "), k)}
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

const INLINE_RE =
  /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(_([^_]+)_)|(`([^`]+)`)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;

function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let idx = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const key = `${keyBase}-i${idx}`;
    if (m[2]) nodes.push(<strong key={key}>{m[2]}</strong>);
    else if (m[4]) nodes.push(<em key={key}>{m[4]}</em>);
    else if (m[6]) nodes.push(<em key={key}>{m[6]}</em>);
    else if (m[8])
      nodes.push(
        <code
          key={key}
          className="rounded bg-slate-200 px-1 py-0.5 font-mono text-[11px]"
        >
          {m[8]}
        </code>,
      );
    else if (m[10])
      nodes.push(
        <a
          key={key}
          href={m[11]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#1d4ed8] hover:underline"
        >
          {m[10]}
        </a>,
      );
    last = m.index + m[0].length;
    idx += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
