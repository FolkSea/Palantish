"use client";

import { useEffect, useMemo, useState } from "react";
import {
  extractIndicators,
  indicatorCount,
  type Indicators,
} from "@/lib/report-indicators";
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

/**
 * Renders a report title as a button that opens an ~80% details modal instead
 * of navigating. Inside the modal the title is a hyperlink to the source.
 */
export function ReportTitle({ report }: { report: ReportModalData }) {
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
        <ReportModal report={report} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function ReportModal({
  report,
  onClose,
}: {
  report: ReportModalData;
  onClose: () => void;
}) {
  // Show the live page when its headers allow framing; otherwise embed a
  // server-fetched HTML snapshot (bypasses X-Frame-Options); and only if even
  // that fails, fall back to scraped text under a notice bar.
  const [view, setView] = useState<
    | { status: "loading" }
    | { status: "frame"; url: string }
    | { status: "embed"; html: string }
    | { status: "fallback"; text: string | null; error?: string }
  >({ status: "loading" });

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
        className="flex w-full flex-col rounded-lg border border-[#e5e7eb] bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[#e5e7eb] px-5 py-3">
          <div className="min-w-0">
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
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md border border-[#e5e7eb] bg-white px-2 py-1 text-[12px] text-slate-600 hover:bg-slate-50"
          >
            Close
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 text-[13px]">
          <Section title="Summary">
            {report.description ? (
              <p className="leading-relaxed text-slate-700">
                {report.description}
              </p>
            ) : (
              <Empty>No summary available.</Empty>
            )}
          </Section>

          <Section title="Details">
            <div className="h-[62vh] overflow-hidden rounded-md border border-[#e5e7eb]">
              {view.status === "loading" ? (
                <div className="flex h-full items-center justify-center bg-slate-50">
                  <Empty>Loading the full report...</Empty>
                </div>
              ) : view.status === "frame" ? (
                <iframe
                  src={view.url}
                  title="Full report"
                  className="h-full w-full"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                  referrerPolicy="no-referrer"
                  loading="lazy"
                />
              ) : view.status === "embed" ? (
                <iframe
                  srcDoc={view.html}
                  title="Full report"
                  className="h-full w-full"
                  sandbox="allow-scripts allow-popups"
                  referrerPolicy="no-referrer"
                />
              ) : (
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
                        {report.url ? (
                          <a
                            href={report.url}
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
              )}
            </div>
          </Section>

          <Section title="IOCs">
            <IocView indicators={indicators} />
          </Section>

          <Section title="MITRE ATT&CK">
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
          </Section>

          <Section title="Visibility Gaps">
            <Empty>Not yet available - to be generated.</Empty>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </h3>
      {children}
    </section>
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

function IocList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium text-slate-500">
        {title} ({items.length})
      </p>
      {items.length ? (
        <ul className="space-y-0.5">
          {items.map((v) => (
            <li key={v} className="break-all font-mono text-[12px] text-slate-700">
              {v}
            </li>
          ))}
        </ul>
      ) : (
        <Empty>None.</Empty>
      )}
    </div>
  );
}

function IocView({ indicators }: { indicators: Indicators }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <IocList title="IP Addresses" items={indicators.ips} />
        <IocList title="Domains" items={indicators.domains} />
        <IocList title="URIs" items={indicators.uris} />
        <IocList title="File Hashes" items={indicators.files} />
      </div>
    </div>
  );
}
