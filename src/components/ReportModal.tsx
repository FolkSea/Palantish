"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  extractIndicators,
  indicatorCount,
  sourceDomain,
  type Indicators,
} from "@/lib/report-indicators";
import {
  fetchReportViewAction,
  persistReportIndicatorsAction,
  discoverTechniquesAction,
  getReportIndicatorsAction,
  deleteReportIocAction,
  updateReportIocAction,
  updateReportAdversaryAction,
  updateReportCountryAction,
  updateReportConfidenceAction,
  updateReportNoteAction,
  updateReportLabelsAction,
  getAttributionOptionsAction,
} from "@/app/actions";
import { EditableIocList } from "./EditableIocList";
import { Markdown } from "./Markdown";
import { AdversaryBadge } from "./Badges";
import {
  REPORT_CONFIDENCES,
  REPORT_CONFIDENCE_LABEL,
  type ReportConfidence,
} from "@/lib/badges";
import { countryFlag } from "@/lib/flags";
import { addActor } from "@/app/settings/catalogue-actions";
import {
  MOTIVATIONS,
  MOTIVATION_LABEL,
  type ActorInput,
  type Motivation,
} from "@/lib/actor-catalogue";
import type { DiscoveredTechnique } from "@/lib/mitre/parse";
import { techniqueInfo } from "@/lib/mitre/techniques";
import { formatDate } from "@/lib/format";

export type ReportModalData = {
  title: string;
  url: string | null;
  description: string | null;
  sourceName: string | null;
  date: string | null;
  adversary?: string | null;
  country?: string | null;
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

  const rawHash = report.rawHash;

  // Locally-tracked attribution + country so edits reflect immediately.
  const [adversary, setAdversary] = useState<string | null>(
    report.adversary ?? null,
  );
  const [country, setCountry] = useState<string | null>(report.country ?? null);
  const [confidence, setConfidence] = useState<string | null>(
    report.confidence ?? null,
  );

  // Autocomplete options for the Attribution + Country inputs.
  const [options, setOptions] = useState<{
    adversaries: string[];
    countries: string[];
  }>({ adversaries: [], countries: [] });
  useEffect(() => {
    if (!rawHash) return;
    getAttributionOptionsAction().then(setOptions);
  }, [rawHash]);

  async function saveConfidence(
    value: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!rawHash) return { ok: false, error: "This report cannot be edited." };
    const res = await updateReportConfidenceAction(rawHash, value);
    if (res.ok) {
      setConfidence(res.confidence);
      if (res.moved) setKind("intel");
    }
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  }

  async function saveAdversary(value: string): Promise<{
    ok: boolean;
    error?: string;
    label: string;
    matched: boolean;
    recognised: boolean;
  }> {
    if (!rawHash)
      return {
        ok: false,
        error: "This report cannot be edited.",
        label: "",
        matched: false,
        recognised: false,
      };
    const res = await updateReportAdversaryAction(rawHash, value);
    if (res.ok) {
      // Unrecognised names are not written - the UI prompts to add them first.
      if (res.recognised) {
        setAdversary(res.label || null);
        if (res.regrouped) setCountry(res.country);
        if (res.moved) setKind("intel");
      }
      return {
        ok: true,
        label: res.label,
        matched: res.matched,
        recognised: res.recognised,
      };
    }
    return {
      ok: false,
      error: res.error,
      label: "",
      matched: false,
      recognised: false,
    };
  }

  // Add an unrecognised name to the catalogue, then attribute this report to it.
  async function addActorAndAttribute(
    input: ActorInput,
  ): Promise<{ ok: boolean; error?: string }> {
    const r = await addActor(input);
    if (!r.ok) return { ok: false, error: r.error };
    getAttributionOptionsAction().then(setOptions); // refresh autocomplete
    const a = await saveAdversary(input.name);
    return a.ok ? { ok: true } : { ok: false, error: a.error };
  }

  async function saveCountry(
    value: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!rawHash) return { ok: false, error: "This report cannot be edited." };
    const res = await updateReportCountryAction(rawHash, value);
    if (res.ok) {
      setCountry(res.country);
      if (res.moved) setKind("intel");
    }
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  }

  // User-defined labels + analyst notes (markdown), loaded with the indicators
  // below.
  const [labels, setLabels] = useState<string[]>([]);
  const [analystComments, setAnalystComments] = useState<string | null>(null);
  const [visibilityGaps, setVisibilityGaps] = useState<string | null>(null);

  async function saveLabels(
    value: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!rawHash) return { ok: false, error: "This report cannot be edited." };
    const res = await updateReportLabelsAction(rawHash, value);
    if (res.ok) setLabels(res.labels);
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  }

  async function saveAnalystComments(
    value: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!rawHash) return { ok: false, error: "This report cannot be edited." };
    const res = await updateReportNoteAction(rawHash, "analyst_comments", value);
    if (res.ok) setAnalystComments(value.trim() || null);
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  }
  async function saveVisibilityGaps(
    value: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!rawHash) return { ok: false, error: "This report cannot be edited." };
    const res = await updateReportNoteAction(rawHash, "visibility_gaps", value);
    if (res.ok) setVisibilityGaps(value.trim() || null);
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  }

  // Prefer indicators already stored (and curated) in the DB; extraction is only
  // a fallback for reports that have none stored yet. `stored` is null until the
  // lookup resolves.
  const [stored, setStored] = useState<Indicators | null>(null);
  // The IOC allowlist (vendor domains / noise IPs) so fallback extraction below
  // drops the same indicators the ingest pipeline does.
  const [allowlist, setAllowlist] = useState<{ domains: string[]; ips: string[] }>(
    { domains: [], ips: [] },
  );
  // What the rawHash resolves to: an intel report, a breach, or neither.
  const [kind, setKind] = useState<"intel" | "breach" | null>(null);
  useEffect(() => {
    if (!rawHash) {
      setStored(null);
      setKind(null);
      setLabels([]);
      setAnalystComments(null);
      setVisibilityGaps(null);
      setAllowlist({ domains: [], ips: [] });
      return;
    }
    let active = true;
    setStored(null);
    setKind(null);
    getReportIndicatorsAction(rawHash).then((r) => {
      if (active && r.ok) {
        setStored(r.indicators);
        setKind(r.kind);
        setLabels(r.labels);
        setAllowlist(r.allowlist);
        setAnalystComments(r.notes.analystComments);
        setVisibilityGaps(r.notes.visibilityGaps);
        // Populate attribution from the DB so it shows regardless of how the
        // modal was opened - a card passes it in the prop, but the executive
        // summary and search do not. The stored value wins; fall back to the
        // prop (e.g. a computed UNID label a card may pass when none is stored).
        setAdversary((prev) => r.attribution.adversary ?? prev);
        setCountry((prev) => r.attribution.country ?? prev);
        setConfidence((prev) => r.attribution.confidence ?? prev);
      }
    });
    return () => {
      active = false;
    };
  }, [rawHash]);

  const extracted = useMemo(() => {
    const own = sourceDomain(report.url);
    const excludeDomains = [...allowlist.domains, ...(own ? [own] : [])];
    return extractIndicators(
      `${report.title} ${report.description ?? ""} ${detailsText}`,
      excludeDomains,
      allowlist.ips,
    );
  }, [report.title, report.description, report.url, detailsText, allowlist]);

  const hasStoredIocs =
    !!stored &&
    stored.ips.length +
      stored.domains.length +
      stored.uris.length +
      stored.files.length +
      stored.cves.length >
      0;
  // IOC cards use stored indicators when the report has them, else extracted.
  // MITRE is preferred from the DB independently (Discover writes it there).
  const baseIndicators: Indicators = {
    ...(hasStoredIocs ? stored! : extracted),
    mitre: stored && stored.mitre.length ? stored.mitre : extracted.mitre,
  };
  // Local edits (delete/replace) overlay the base set until the modal reopens.
  const [iocEdits, setIocEdits] = useState<Indicators | null>(null);
  const indicators = iocEdits ?? baseIndicators;
  // The breach modal behaves exactly like a report modal: every editor is live,
  // and the first attribution edit reclassifies the breach into a report (the
  // edit actions convert it and return moved:true, which flips kind here).
  const attributable = kind === "intel" || kind === "breach";
  const iocsEditable = attributable;

  function removeIoc(key: keyof Indicators, value: string) {
    setIocEdits((cur) => {
      const base = cur ?? baseIndicators;
      return { ...base, [key]: (base[key] as string[]).filter((v) => v !== value) };
    });
    if (rawHash) deleteReportIocAction(rawHash, value).catch(() => {});
  }

  async function editIoc(
    key: keyof Indicators,
    type: string,
    oldValue: string,
    newValue: string,
  ): Promise<string | null> {
    if (!rawHash) return "This report cannot be edited.";
    const res = await updateReportIocAction(rawHash, oldValue, newValue, type);
    if (!res.ok) return res.error;
    setIocEdits((cur) => {
      const base = cur ?? baseIndicators;
      const next = (base[key] as string[]).map((v) => (v === oldValue ? res.value : v));
      return { ...base, [key]: [...new Set(next)] };
    });
    return null;
  }

  // Persist extracted IOCs only when the DB has none yet, so opening a report
  // reuses stored data instead of re-extracting and re-writing it every time.
  const extractedCount = indicatorCount(extracted);
  useEffect(() => {
    // Only reports own stored IOCs; a breach has none until it is attributed and
    // converted, at which point kind flips to "intel" and this re-runs.
    if (kind !== "intel") return;
    if (!rawHash || !detailsText || stored === null || hasStoredIocs) return;
    if (extractedCount === 0) return;
    persistReportIndicatorsAction(rawHash, extracted).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawHash, detailsText, stored, hasStoredIocs, extractedCount, kind]);

  // MITRE ATT&CK discovery (LLM). Only runs when the user clicks Discover.
  const [techniques, setTechniques] = useState<DiscoveredTechnique[] | null>(
    null,
  );
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  function runDiscover() {
    if (discovering || !detailsText) return;
    setDiscovering(true);
    setDiscoverError(null);
    const text = `${report.title} ${report.description ?? ""} ${detailsText}`;
    discoverTechniquesAction(rawHash ?? null, text).then((r) => {
      setDiscovering(false);
      if (!r.ok) {
        setDiscoverError(r.error);
        return;
      }
      setTechniques(r.techniques);
      // Discover wrote the codes to the DB; reflect them in the editable set.
      setIocEdits((cur) => ({
        ...(cur ?? baseIndicators),
        mitre: [...new Set(r.techniques.map((t) => t.code))],
      }));
    });
  }

  // Display / tooltip for a MITRE code. The name comes from the model when a
  // technique was discovered, otherwise from the local ATT&CK reference; the
  // tooltip shows the code (hidden from the label) plus a description. Both are
  // computed from the current value, so an edit updates them automatically.
  const llmNames = new Map((techniques ?? []).map((t) => [t.code, t.name]));
  function techniqueName(code: string): string {
    const llm = llmNames.get(code);
    if (llm && llm !== code) return llm;
    return techniqueInfo(code)?.name ?? code;
  }
  function techniqueTip(code: string): string {
    const info = techniqueInfo(code);
    return info ? `${code} - ${info.description}` : `${code} - MITRE ATT&CK technique`;
  }

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
              <EditableAttribution
                value={adversary}
                editable={attributable}
                onSave={saveAdversary}
                onAddActor={addActorAndAttribute}
                suggestions={options.adversaries}
              />
              <EditableCountry
                value={country}
                editable={iocsEditable}
                onSave={saveCountry}
                suggestions={options.countries}
              />
              <EditableConfidence
                value={confidence}
                editable={iocsEditable}
                onSave={saveConfidence}
              />
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
            <div className="flex items-center gap-2">
              {rawHash ? (
                <a
                  href={`/graph?seed=${encodeURIComponent(rawHash)}`}
                  title="Open this report in the link-analysis graph"
                  className="inline-flex items-center gap-1 rounded-md border border-[#e5e7eb] bg-white px-2 py-1 text-[12px] font-medium text-[#1d4ed8] hover:bg-slate-50"
                >
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
                  >
                    <circle cx="5" cy="6" r="2.5" />
                    <circle cx="19" cy="6" r="2.5" />
                    <circle cx="12" cy="18" r="2.5" />
                    <path d="M7 7.5 10.5 16M17 7.5 13.5 16" />
                  </svg>
                  Graph
                </a>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-md border border-[#e5e7eb] bg-white px-2 py-1 text-[12px] text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
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

            <CollapsibleCard title="Labels" count={labels.length}>
              <LabelEditor
                labels={labels}
                editable={iocsEditable}
                onSave={saveLabels}
              />
            </CollapsibleCard>

            <CollapsibleCard title="Analyst Comments">
              <EditableMarkdown
                value={analystComments}
                editable={iocsEditable}
                placeholder="No analyst comments yet."
                onSave={saveAnalystComments}
              />
            </CollapsibleCard>

            <CollapsibleCard title="Visibility Gaps">
              <EditableMarkdown
                value={visibilityGaps}
                editable={iocsEditable}
                placeholder="No visibility gaps recorded yet."
                onSave={saveVisibilityGaps}
              />
            </CollapsibleCard>

            <CollapsibleCard title="IP Addresses" count={indicators.ips.length}>
              <EditableIocList
                items={indicators.ips}
                type="ip"
                editable={iocsEditable}
                onRemove={(v) => removeIoc("ips", v)}
                onEdit={(o, n) => editIoc("ips", "ip", o, n)}
              />
            </CollapsibleCard>

            <CollapsibleCard title="Domains" count={indicators.domains.length}>
              <EditableIocList
                items={indicators.domains}
                type="domain"
                editable={iocsEditable}
                onRemove={(v) => removeIoc("domains", v)}
                onEdit={(o, n) => editIoc("domains", "domain", o, n)}
              />
            </CollapsibleCard>

            <CollapsibleCard title="URIs" count={indicators.uris.length}>
              <EditableIocList
                items={indicators.uris}
                type="uri"
                editable={iocsEditable}
                onRemove={(v) => removeIoc("uris", v)}
                onEdit={(o, n) => editIoc("uris", "uri", o, n)}
              />
            </CollapsibleCard>

            <CollapsibleCard title="Hashes" count={indicators.files.length}>
              <EditableIocList
                items={indicators.files}
                type="file_hash"
                editable={iocsEditable}
                onRemove={(v) => removeIoc("files", v)}
                onEdit={(o, n) => editIoc("files", "file_hash", o, n)}
              />
            </CollapsibleCard>

            <CollapsibleCard title="CVEs" count={indicators.cves.length}>
              <EditableIocList
                items={indicators.cves}
                type="cve"
                editable={iocsEditable}
                onRemove={(v) => removeIoc("cves", v)}
                onEdit={(o, n) => editIoc("cves", "cve", o, n)}
              />
            </CollapsibleCard>

            <CollapsibleCard
              title="MITRE ATT&CK"
              count={indicators.mitre.length}
              action={
                <button
                  type="button"
                  onClick={runDiscover}
                  disabled={discovering || !detailsText}
                  title="Infer ATT&CK techniques from the report with AI"
                  className="rounded border border-[#e5e7eb] bg-white px-2 py-0.5 text-[10px] font-medium text-[#1d4ed8] hover:bg-slate-50 disabled:opacity-50"
                >
                  {discovering ? "Discovering..." : "Discover"}
                </button>
              }
            >
              {discovering ? (
                <Empty>Analysing the report...</Empty>
              ) : discoverError ? (
                <p className="text-[12px] text-red-600">{discoverError}</p>
              ) : (
                <EditableIocList
                  items={indicators.mitre}
                  type="mitre"
                  editable={iocsEditable}
                  display={techniqueName}
                  tooltip={techniqueTip}
                  onRemove={(v) => removeIoc("mitre", v)}
                  onEdit={(o, n) => editIoc("mitre", "mitre", o, n)}
                  emptyLabel="Use Discover to infer techniques from the report."
                />
              )}
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
  action,
  defaultOpen = true,
  children,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-md border border-[#e5e7eb] bg-white">
      <div className="flex items-center gap-1 pr-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex flex-1 items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50"
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
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {open ? (
        <div className="border-t border-[#e5e7eb] px-3 py-2">{children}</div>
      ) : null}
    </div>
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

/**
 * The report's attributed adversary. When editable, an alias entered here is
 * resolved back to the preferred catalogue name (and the report's country
 * updates to match); free text that matches nothing is kept as-is.
 */
function EditableAttribution({
  value,
  editable,
  onSave,
  onAddActor,
  suggestions = [],
}: {
  value: string | null;
  editable: boolean;
  onSave: (value: string) => Promise<{
    ok: boolean;
    error?: string;
    label: string;
    matched: boolean;
    recognised: boolean;
  }>;
  onAddActor: (input: ActorInput) => Promise<{ ok: boolean; error?: string }>;
  suggestions?: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);

  async function save() {
    const v = draft.trim();
    setBusy(true);
    setError(null);
    const res = await onSave(v);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Update failed.");
      return;
    }
    if (!res.recognised) {
      // Unrecognised name: prompt to add it to the catalogue (nothing written).
      setPendingAdd(v);
      return;
    }
    setHint(
      res.matched && res.label.toLowerCase() !== v.toLowerCase()
        ? `mapped alias to ${res.label}`
        : null,
    );
    setEditing(false);
  }

  function cancel() {
    setEditing(false);
    setDraft(value ?? "");
    setError(null);
  }

  if (!editable) {
    if (!value) return null;
    return (
      <span className="inline-flex items-center gap-1">
        <span className="font-medium text-slate-400">Attribution:</span>
        <AdversaryBadge name={value} />
      </span>
    );
  }

  const field = editing ? (
    <span className="inline-flex items-center gap-1">
      <span className="font-medium text-slate-400">Attribution:</span>
      <input
        autoFocus
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            cancel();
          }
        }}
        placeholder="Adversary or alias"
        list="attribution-suggestions"
        className="w-40 rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-800 outline-none focus:border-slate-400"
      />
      <datalist id="attribution-suggestions">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="rounded px-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
      >
        Save
      </button>
      <button
        type="button"
        onClick={cancel}
        className="rounded px-1 text-[11px] text-slate-500 hover:bg-slate-100"
      >
        Cancel
      </button>
      {error ? <span className="text-[10px] text-red-600">{error}</span> : null}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1">
      <span className="font-medium text-slate-400">Attribution:</span>
      {value ? (
        <AdversaryBadge name={value} />
      ) : (
        <span className="italic text-slate-400">unattributed</span>
      )}
      <button
        type="button"
        title="Edit attribution"
        aria-label="Edit attribution"
        onClick={() => {
          setDraft(value ?? "");
          setEditing(true);
          setHint(null);
        }}
        className="text-slate-400 hover:text-slate-700"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </button>
      {hint ? (
        <span className="text-[10px] text-emerald-600">({hint})</span>
      ) : null}
    </span>
  );

  return (
    <>
      {field}
      {pendingAdd !== null ? (
        <AddActorDialog
          name={pendingAdd}
          onAdd={async (input) => {
            const r = await onAddActor(input);
            if (r.ok) {
              setPendingAdd(null);
              setEditing(false);
              setHint(null);
            }
            return r;
          }}
          onCancel={() => {
            // Nothing was written; just restore the original value.
            setPendingAdd(null);
            cancel();
          }}
        />
      ) : null}
    </>
  );
}

/** Prompt to add an unrecognised actor name to the catalogue. */
function AddActorDialog({
  name,
  onAdd,
  onCancel,
}: {
  name: string;
  onAdd: (input: ActorInput) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;
}) {
  const [actorName, setActorName] = useState(name);
  const [motivation, setMotivation] = useState<string>("nation_state");
  const [country, setCountry] = useState("");
  const [aliases, setAliases] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!actorName.trim()) return;
    setBusy(true);
    setError(null);
    const res = await onAdd({
      name: actorName,
      motivation,
      country,
      aliases,
      description: "",
    });
    setBusy(false);
    if (!res.ok) setError(res.error ?? "Failed to add actor.");
  }

  const labelCls = "block text-[11px] font-medium text-slate-600";
  const inputCls =
    "mt-0.5 w-full rounded-md border border-[#e5e7eb] bg-white px-2 py-1 text-[12px] text-slate-900 outline-none focus:border-slate-400";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-[#e5e7eb] bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[13px] font-semibold text-slate-900">
          Add new actor
        </h3>
        <p className="mt-1 text-[11px] text-slate-500">
          &ldquo;{name}&rdquo; isn&rsquo;t in the actor list. Add it so it is
          recognised from now on.
        </p>
        <div className="mt-3 space-y-2">
          <label className={labelCls}>
            Name
            <input
              className={inputCls}
              value={actorName}
              onChange={(e) => setActorName(e.target.value)}
            />
          </label>
          <label className={labelCls}>
            Motivation
            <select
              className={inputCls}
              value={motivation}
              onChange={(e) => setMotivation(e.target.value)}
            >
              {MOTIVATIONS.map((m) => (
                <option key={m} value={m}>
                  {MOTIVATION_LABEL[m as Motivation]}
                </option>
              ))}
            </select>
          </label>
          {motivation === "nation_state" ? (
            <label className={labelCls}>
              Country
              <input
                className={inputCls}
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="e.g. China"
              />
            </label>
          ) : null}
          <label className={labelCls}>
            Aliases (comma-separated)
            <input
              className={inputCls}
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              placeholder="APT41, Barium"
            />
          </label>
        </div>
        {error ? (
          <p className="mt-2 text-[11px] text-red-600">{error}</p>
        ) : null}
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={add}
            disabled={busy || !actorName.trim()}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-slate-700 disabled:opacity-60"
          >
            {busy ? "Adding..." : "Add actor"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-[#e5e7eb] bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** Editable country - a plain manual override for the report's grouping. */
function EditableCountry({
  value,
  editable,
  onSave,
  suggestions = [],
}: {
  value: string | null;
  editable: boolean;
  onSave: (value: string) => Promise<{ ok: boolean; error?: string }>;
  suggestions?: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await onSave(draft.trim());
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Update failed.");
      return;
    }
    setEditing(false);
  }

  function cancel() {
    setEditing(false);
    setDraft(value ?? "");
    setError(null);
  }

  const flag = countryFlag(value);

  if (!editable) {
    if (!value) return null;
    return (
      <span className="inline-flex items-center gap-1">
        <span className="font-medium text-slate-400">Country:</span>
        {flag ? <span className="leading-none">{flag}</span> : null}
        {value}
      </span>
    );
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="font-medium text-slate-400">Country:</span>
        <input
          autoFocus
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              cancel();
            }
          }}
          placeholder="Country"
          list="country-suggestions"
          className="w-32 rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-800 outline-none focus:border-slate-400"
        />
        <datalist id="country-suggestions">
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded px-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={cancel}
          className="rounded px-1 text-[11px] text-slate-500 hover:bg-slate-100"
        >
          Cancel
        </button>
        {error ? <span className="text-[10px] text-red-600">{error}</span> : null}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-medium text-slate-400">Country:</span>
      {flag ? <span className="leading-none">{flag}</span> : null}
      <span>
        {value ?? <span className="italic text-slate-400">unattributed</span>}
      </span>
      <button
        type="button"
        title="Edit country"
        aria-label="Edit country"
        onClick={() => {
          setDraft(value ?? "");
          setEditing(true);
        }}
        className="text-slate-400 hover:text-slate-700"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </button>
    </span>
  );
}

/** Editable confidence presented as a dropdown; saves on change. */
function EditableConfidence({
  value,
  editable,
  onSave,
}: {
  value: string | null;
  editable: boolean;
  onSave: (value: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editable) {
    if (!value) return null;
    return (
      <span>
        <span className="font-medium text-slate-400">Confidence:</span>{" "}
        {REPORT_CONFIDENCE_LABEL[value as ReportConfidence] ?? value}
      </span>
    );
  }

  async function onChange(v: string) {
    setBusy(true);
    setError(null);
    const res = await onSave(v);
    setBusy(false);
    if (!res.ok) setError(res.error ?? "Update failed.");
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-medium text-slate-400">Confidence:</span>
      <select
        value={value ?? "medium"}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] text-slate-800 outline-none focus:border-slate-400 disabled:opacity-50"
      >
        {REPORT_CONFIDENCES.map((c) => (
          <option key={c} value={c}>
            {REPORT_CONFIDENCE_LABEL[c]}
          </option>
        ))}
      </select>
      {error ? <span className="text-[10px] text-red-600">{error}</span> : null}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] italic text-slate-400">{children}</p>;
}

/**
 * User-defined labels for a report. Displays the stored labels as chips and,
 * when editable, offers a comma-separated text box: text entered is split on
 * commas into individual labels, which are persisted and linked to the report.
 */
function LabelEditor({
  labels,
  editable,
  onSave,
}: {
  labels: string[];
  editable: boolean;
  onSave: (value: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(labels.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the draft in sync when labels load/change while not editing.
  useEffect(() => {
    if (!editing) setDraft(labels.join(", "));
  }, [labels, editing]);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await onSave(draft);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Save failed.");
      return;
    }
    setEditing(false);
  }

  function cancel() {
    setEditing(false);
    setDraft(labels.join(", "));
    setError(null);
  }

  if (editing) {
    return (
      <div>
        <input
          autoFocus
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              cancel();
            }
          }}
          placeholder="Comma-separated, e.g. ransomware, finance, priority"
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-[12px] text-slate-800 outline-none focus:border-slate-400"
        />
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded px-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={cancel}
            className="rounded px-1 text-[11px] text-slate-500 hover:bg-slate-100"
          >
            Cancel
          </button>
          <span className="text-[10px] text-slate-400">
            Separate labels with commas.
          </span>
          {error ? (
            <span className="text-[10px] text-red-600">{error}</span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div>
      {labels.length ? (
        <div className="flex flex-wrap gap-1">
          {labels.map((l) => (
            <span
              key={l}
              className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700"
            >
              {l}
            </span>
          ))}
        </div>
      ) : (
        <Empty>No labels yet.</Empty>
      )}
      {editable ? (
        <button
          type="button"
          onClick={() => {
            setDraft(labels.join(", "));
            setEditing(true);
          }}
          className="mt-1 rounded px-1 text-[11px] font-medium text-[#1d4ed8] hover:bg-slate-100"
        >
          {labels.length ? "Edit" : "Add"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * A multiline markdown note: renders the stored markdown, and (when editable)
 * offers an Edit affordance that swaps in a textarea. Saves on demand.
 */
function EditableMarkdown({
  value,
  editable,
  placeholder,
  onSave,
}: {
  value: string | null;
  editable: boolean;
  placeholder: string;
  onSave: (value: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the draft in sync when the value loads/changes while not editing.
  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await onSave(draft);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Save failed.");
      return;
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <div>
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setEditing(false);
              setDraft(value ?? "");
              setError(null);
            }
          }}
          rows={6}
          placeholder={`${placeholder} Markdown supported.`}
          className="w-full resize-y rounded border border-slate-300 px-2 py-1.5 font-mono text-[12px] text-slate-800 outline-none focus:border-slate-400"
        />
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded px-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setDraft(value ?? "");
              setError(null);
            }}
            className="rounded px-1 text-[11px] text-slate-500 hover:bg-slate-100"
          >
            Cancel
          </button>
          {error ? (
            <span className="text-[10px] text-red-600">{error}</span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div>
      {value ? (
        <div className="text-[12px]">
          <Markdown text={value} />
        </div>
      ) : (
        <Empty>{placeholder}</Empty>
      )}
      {editable ? (
        <button
          type="button"
          onClick={() => {
            setDraft(value ?? "");
            setEditing(true);
          }}
          className="mt-1 rounded px-1 text-[11px] font-medium text-[#1d4ed8] hover:bg-slate-100"
        >
          {value ? "Edit" : "Add"}
        </button>
      ) : null}
    </div>
  );
}
