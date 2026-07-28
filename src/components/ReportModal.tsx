"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { extractIndicators, indicatorCount } from "@/lib/report-indicators";
import {
  fetchReportViewAction,
  persistReportIndicatorsAction,
} from "@/app/actions";
import { formatDate } from "@/lib/format";

export type ReportModalData = {
  title: string;
  url: string | null;
  description: string | null;
  sourceName: string | null;
  date: string | null;
  adversary?: string | null;
  confidence?: string | null;
  rawHash?: string | null;
};

type ViewState =
  | { status: "loading" }
  | { status: "frame"; url: string }
  | { status: "embed"; html: string }
  | { status: "fallback"; text: string | null; error?: string };

/**
 * Renders a report title as a button that opens an ~80% details modal instead
 * of navigating. Inside the modal the title is a hyperlink to the source.
 */
export function ReportTitle({ report }: { report: ReportModalData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-left font-medium text-[#1d4ed8] hover:underline"
      >
        {report.title}
      </button>
      {open ? (
        <ReportModal
          report={report}
          onClose={() => {
            setOpen(false);
            // Refresh the dashboard on exit so any IOCs persisted while viewing
            // are reflected.
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

export function ReportModal({
  report,
  onClose,
}: {
  report: ReportModalData;
  onClose: () => void;
}) {
  // Show the live page when its headers allow framing; otherwise embed a
  // server-fetched HTML snapshot (bypasses X-Frame-Options); and only if even
  // that fails, fall back to scraped text under a notice bar.
  const [view, setView] = useState<ViewState>({ status: "loading" });

  // Draggable divider: left column width as a percentage of the modal width.
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftPct, setLeftPct] = useState(75);
  const [dragging, setDragging] = useState(false);

  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    setDragging(true);
    const onMove = (ev: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setLeftPct(Math.min(85, Math.max(25, pct)));
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // The scraped article body drives IOC extraction regardless of how the
  // Details pane is rendered (live frame, snapshot, or text).
  const [detailsText, setDetailsText] = useState("");

  useEffect(() => {
    if (!report.url) {
      setView({ status: "fallback", text: null, error: "No report link available." });
      setDetailsText("");
      return;
    }
    const url = report.url;
    let active = true;
    setView({ status: "loading" });
    setDetailsText("");
    fetchReportViewAction(url).then((r) => {
      if (!active) return;
      if (r.ok && r.frameable) setView({ status: "frame", url });
      else if (r.ok && r.html) setView({ status: "embed", html: r.html });
      else if (r.ok) setView({ status: "fallback", text: r.text || null });
      else setView({ status: "fallback", text: null, error: r.error });
      setDetailsText(r.ok ? r.text : "");
    });
    return () => {
      active = false;
    };
  }, [report.url]);

  const indicators = useMemo(
    () =>
      extractIndicators(
        `${report.title} ${report.description ?? ""} ${detailsText}`,
      ),
    [report.title, report.description, detailsText],
  );

  // Persist the extracted IOCs and link them to this report so they become
  // searchable. Idempotent server-side; runs once the body text has loaded.
  const rawHash = report.rawHash;
  const count = indicatorCount(indicators);
  useEffect(() => {
    if (!rawHash || !detailsText || count === 0) return;
    persistReportIndicatorsAction(rawHash, indicators).catch(() => {});
    // Re-runs only when the linked report or its indicator set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawHash, detailsText, count]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 p-[5px]"
      onClick={onClose}
    >
      <div
        ref={containerRef}
        className="relative flex w-full overflow-hidden rounded-lg border border-[#e5e7eb] bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: title + the imported report */}
        <div
          className="flex min-w-0 flex-col"
          style={{ width: `${leftPct}%` }}
        >
          <header className="shrink-0 border-b border-[#e5e7eb] px-5 py-3">
            {report.url ? (
              <a
                href={report.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[15px] font-semibold text-[#1d4ed8] hover:underline"
              >
                {report.title}
              </a>
            ) : (
              <span className="text-[15px] font-semibold text-slate-900">
                {report.title}
              </span>
            )}
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500">
              <Meta label="Source" value={report.sourceName} />
              <Meta
                label="Published"
                value={report.date ? formatDate(report.date) : null}
              />
              <Meta label="Attribution" value={report.adversary ?? null} />
              <Meta label="Confidence" value={report.confidence ?? null} />
              {report.url ? (
                <span>
                  <span className="font-medium text-slate-400">Link:</span>{" "}
                  <a
                    href={report.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#1d4ed8] hover:underline"
                  >
                    open report
                  </a>
                </span>
              ) : null}
            </div>
          </header>
          <div className="flex-1 overflow-hidden p-3">
            <div className="h-full overflow-hidden rounded-md border border-[#e5e7eb]">
              <ReportBody view={view} url={report.url} />
            </div>
          </div>
        </div>

        {/* Draggable divider: drag to change the column widths */}
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={startDrag}
          className="group relative w-1 shrink-0 cursor-col-resize bg-[#e5e7eb] hover:bg-slate-400"
        >
          <span className="absolute inset-y-0 -left-1.5 -right-1.5" />
        </div>

        {/* Right: collapsible information cards */}
        <div className="flex min-w-0 flex-1 flex-col bg-slate-50">
          <div className="flex shrink-0 items-center justify-between border-b border-[#e5e7eb] px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Report details
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md border border-[#e5e7eb] bg-white px-2 py-1 text-[12px] text-slate-600 hover:bg-slate-50"
            >
              Close
            </button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3 text-[13px]">
            <CollapsibleCard title="Summary">
              {report.description ? (
                <p className="leading-relaxed text-slate-700">
                  {report.description}
                </p>
              ) : (
                <Empty>No summary available.</Empty>
              )}
            </CollapsibleCard>

            <CollapsibleCard title="IP Addresses" count={indicators.ips.length}>
              <IocItems items={indicators.ips} />
            </CollapsibleCard>

            <CollapsibleCard title="Domains" count={indicators.domains.length}>
              <IocItems items={indicators.domains} />
            </CollapsibleCard>

            <CollapsibleCard title="URIs" count={indicators.uris.length}>
              <IocItems items={indicators.uris} />
            </CollapsibleCard>

            <CollapsibleCard title="Hashes" count={indicators.files.length}>
              <IocItems items={indicators.files} />
            </CollapsibleCard>

            <CollapsibleCard title="MITRE ATT&CK" count={indicators.mitre.length}>
              {indicators.mitre.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {indicators.mitre.map((t) => (
                    <span
                      key={t}
                      className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-700"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              ) : (
                <Empty>No techniques identified.</Empty>
              )}
            </CollapsibleCard>

            <CollapsibleCard title="Visibility Gaps">
              <Empty>Not yet available - to be generated.</Empty>
            </CollapsibleCard>
          </div>
        </div>

        {/* While dragging, this overlay captures the mouse so moves over the
            report iframe still reach the window listeners. */}
        {dragging ? (
          <div className="fixed inset-0 z-[60] cursor-col-resize select-none" />
        ) : null}
      </div>
    </div>
  );
}

/** The imported report body: live frame, server-fetched snapshot, or scraped
 * text (with a notice bar), depending on what the server could retrieve. */
function ReportBody({ view, url }: { view: ViewState; url: string | null }) {
  if (view.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50">
        <Empty>Loading the full report...</Empty>
      </div>
    );
  }
  if (view.status === "frame") {
    return (
      <iframe
        src={view.url}
        title="Full report"
        className="h-full w-full"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        referrerPolicy="no-referrer"
        loading="lazy"
      />
    );
  }
  if (view.status === "embed") {
    return (
      <iframe
        srcDoc={view.html}
        title="Full report"
        className="h-full w-full"
        sandbox="allow-scripts allow-popups"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[12px] font-medium text-amber-800">
        Unable to retrieve web page. Attempting to scrape text.
      </div>
      <div className="flex-1 overflow-y-auto bg-slate-50 px-4 py-3">
        {view.text ? (
          <div className="space-y-2 leading-relaxed text-slate-700">
            {view.text.split("\n").map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        ) : (
          <div className="text-[12px] text-slate-500">
            <p>
              Could not load the report text
              {view.error ? ` (${view.error})` : ""}.
            </p>
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#1d4ed8] hover:underline"
              >
                Open the report at the source
              </a>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function CollapsibleCard({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-md border border-[#e5e7eb] bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50"
      >
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {title}
          {typeof count === "number" ? (
            <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-medium text-slate-500">
              {count}
            </span>
          ) : null}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`shrink-0 text-slate-400 transition-transform ${open ? "" : "-rotate-90"}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div className="border-t border-[#e5e7eb] px-3 py-2">{children}</div>
      ) : null}
    </div>
  );
}

function IocItems({ items }: { items: string[] }) {
  if (!items.length) return <Empty>None.</Empty>;
  return (
    <ul className="space-y-0.5">
      {items.map((v) => (
        <li key={v} className="break-all font-mono text-[12px] text-slate-700">
          {v}
        </li>
      ))}
    </ul>
  );
}

function Meta({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <span>
      <span className="font-medium text-slate-400">{label}:</span> {value}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] italic text-slate-400">{children}</p>;
}
