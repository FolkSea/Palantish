"use client";

import { useEffect, useMemo, useState } from "react";
import { extractIndicators, type Indicators } from "@/lib/report-indicators";
import { fetchReportTextAction } from "@/app/actions";
import { formatDate } from "@/lib/format";

export type ReportModalData = {
  title: string;
  url: string | null;
  description: string | null;
  sourceName: string | null;
  date: string | null;
  adversary?: string | null;
  confidence?: string | null;
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
  const indicators = useMemo(
    () => extractIndicators(`${report.title} ${report.description ?? ""}`),
    [report],
  );

  // Fetch the full report text server-side (works even when the site blocks
  // framing). Falls back to the summary + source link on failure.
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ok"; text: string }
    | { status: "error"; error: string }
  >({ status: "loading" });

  useEffect(() => {
    if (!report.url) {
      setState({ status: "error", error: "No report link available." });
      return;
    }
    let active = true;
    setState({ status: "loading" });
    fetchReportTextAction(report.url).then((r) => {
      if (!active) return;
      setState(
        r.ok
          ? { status: "ok", text: r.text }
          : { status: "error", error: r.error },
      );
    });
    return () => {
      active = false;
    };
  }, [report.url]);

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
            <div className="h-[62vh] overflow-y-auto rounded-md border border-[#e5e7eb] bg-slate-50 px-4 py-3">
              {state.status === "loading" ? (
                <Empty>Loading the full report...</Empty>
              ) : state.status === "error" ? (
                <div className="text-[12px] text-slate-500">
                  <p>Could not load the report text ({state.error}).</p>
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
              ) : (
                <div className="space-y-2 leading-relaxed text-slate-700">
                  {state.text.split("\n").map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <IocList title="IP Addresses" items={indicators.ips} />
        <IocList title="Domains" items={indicators.domains} />
        <IocList title="URIs" items={indicators.uris} />
      </div>
      <div>
        <p className="mb-1 text-[11px] font-medium text-slate-500">
          Files ({indicators.files.length})
        </p>
        {indicators.files.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                  <th className="py-1 pr-3 font-medium">SHA1</th>
                  <th className="py-1 pr-3 font-medium">Name</th>
                  <th className="py-1 font-medium">Comment</th>
                </tr>
              </thead>
              <tbody>
                {indicators.files.map((f, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="break-all py-1 pr-3 font-mono text-slate-700">
                      {f.sha1 ?? "-"}
                    </td>
                    <td className="py-1 pr-3 font-mono text-slate-700">
                      {f.name ?? "-"}
                    </td>
                    <td className="py-1 text-slate-500">{f.comment ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>None.</Empty>
        )}
      </div>
    </div>
  );
}
