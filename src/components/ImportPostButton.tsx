"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  importPostAction,
  importPostWithAIAction,
  importPostManualAction,
} from "@/app/actions";
import type { ImportResult } from "@/lib/ingest/import-post";
import { ReportModal, type ReportModalData } from "@/components/ReportModal";

function truncate(s: string, n = 70): string {
  return s.length > n ? `${s.slice(0, n - 1)}...` : s;
}

type Toast = { kind: "ok" | "err"; text: string };

/**
 * The single-report import flow (URL entry + scrape-failure recovery + result
 * modal). By default it renders its own "Import post" button; pass `trigger` to
 * render a custom control (e.g. a menu item) that opens the flow instead.
 */
export function ImportPostButton({
  trigger,
  openSignal,
}: {
  trigger?: (open: () => void, pending: boolean) => React.ReactNode;
  // Increment to open the flow from an external control (e.g. a menu item),
  // keeping this component mounted so its modal survives the trigger unmounting.
  openSignal?: number;
} = {}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<Toast | null>(null);
  // Recovery flow state: the URL whose scrape failed, plus which panel is open.
  const [url, setUrl] = useState<string | null>(null);
  const [panel, setPanel] = useState<"url" | "choice" | "paste" | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteBody, setPasteBody] = useState("");
  // The just-imported report, shown in the same modal as a list click.
  const [imported, setImported] = useState<ReportModalData | null>(null);

  function onSuccess(res: Extract<ImportResult, { ok: true }>) {
    const added = res.sourceCreated ? ` New source added: ${res.sourceName}.` : "";
    setToast({
      kind: "ok",
      text: `Imported "${truncate(res.title)}" as ${res.route}.${added}`,
    });
    setPanel(null);
    setUrl(null);
    setUrlInput("");
    setPasteTitle("");
    setPasteBody("");
    // Every import is a report now; open it in the modal (the dashboard is
    // refreshed when the modal is closed - see the ReportModal onClose below).
    setImported(res.report);
  }

  function openImport() {
    setToast(null);
    setPanelError(null);
    setUrlInput("");
    setPanel("url");
  }

  function submitUrl() {
    const target = urlInput.trim();
    if (!target) {
      setPanelError("Enter a URL to import.");
      return;
    }
    setToast(null);
    setPanelError(null);
    startTransition(async () => {
      const res = await importPostAction(target);
      if (res.ok) {
        onSuccess(res);
      } else if (res.recoverable) {
        // Scrape failed: offer AI or paste.
        setUrl(target);
        setPanelError(res.error);
        setPanel("choice");
      } else {
        // Non-recoverable (bad URL, already imported): keep the panel open.
        setPanelError(res.error);
      }
    });
  }

  function runAi() {
    if (!url) return;
    setPanelError(null);
    startTransition(async () => {
      const res = await importPostWithAIAction(url);
      if (res.ok) onSuccess(res);
      else setPanelError(res.error);
    });
  }

  function submitPaste() {
    if (!url) return;
    if (!pasteTitle.trim()) {
      setPanelError("A title is required.");
      return;
    }
    setPanelError(null);
    startTransition(async () => {
      const res = await importPostManualAction(url, pasteTitle, pasteBody);
      if (res.ok) onSuccess(res);
      else setPanelError(res.error);
    });
  }

  function closePanels() {
    setPanel(null);
    setUrl(null);
    setPanelError(null);
    setUrlInput("");
    setPasteTitle("");
    setPasteBody("");
  }

  // Open the flow when an external control bumps openSignal.
  useEffect(() => {
    if (openSignal) openImport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);

  return (
    <>
      {trigger ? (
        trigger(openImport, pending && panel === null)
      ) : (
        <button
          type="button"
          onClick={openImport}
          disabled={pending && panel === null}
          title="Import a blog post by URL"
          className="rounded-md border border-[#e5e7eb] bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
        >
          {pending && panel === null ? "Importing..." : "Import post"}
        </button>
      )}

      {/* URL entry modal */}
      {panel === "url" ? (
        <Modal onClose={closePanels}>
          <h2 className="text-[14px] font-semibold text-slate-900">
            Import a blog post
          </h2>
          <p className="mt-1 text-[12px] text-slate-600">
            Paste the article or blog post URL to import.
          </p>
          {panelError ? (
            <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
              {panelError}
            </p>
          ) : null}
          <label className="mt-3 block">
            <span className="mb-1 block text-[11px] font-medium text-slate-600">
              URL
            </span>
            <input
              autoFocus
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitUrl();
                }
              }}
              placeholder="https://example.com/blog/post"
              className="w-full rounded-md border border-[#e5e7eb] bg-white px-2.5 py-1.5 text-[12px] text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
          </label>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={closePanels}
              className="text-[11px] text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitUrl}
              disabled={pending}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-slate-700 disabled:opacity-60"
            >
              {pending ? "Importing..." : "Import"}
            </button>
          </div>
        </Modal>
      ) : null}

      {/* Choice overlay: scrape failed, pick a fallback */}
      {panel === "choice" ? (
        <Modal onClose={closePanels}>
          <h2 className="text-[14px] font-semibold text-slate-900">
            Couldn&apos;t read that page automatically
          </h2>
          <p className="mt-1 break-all text-[11px] text-slate-500">{url}</p>
          {panelError ? (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
              {panelError}
            </p>
          ) : null}
          <p className="mt-3 text-[12px] text-slate-600">
            Choose how to import it:
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <button
              type="button"
              onClick={runAi}
              disabled={pending}
              className="rounded-md bg-slate-900 px-3 py-2 text-left text-[12px] font-medium text-white hover:bg-slate-700 disabled:opacity-60"
            >
              {pending ? "Reading with AI..." : "Use AI to read the page"}
              <span className="block text-[11px] font-normal text-slate-300">
                Fetches the page and lets the model extract the title and summary.
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setPanelError(null);
                setPanel("paste");
              }}
              disabled={pending}
              className="rounded-md border border-[#e5e7eb] bg-white px-3 py-2 text-left text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Paste the text myself
              <span className="block text-[11px] font-normal text-slate-400">
                Copy the title and body/summary from the blog.
              </span>
            </button>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={closePanels}
              className="text-[11px] text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>
        </Modal>
      ) : null}

      {/* Paste modal: title + body */}
      {panel === "paste" ? (
        <Modal onClose={closePanels}>
          <h2 className="text-[14px] font-semibold text-slate-900">
            Paste the blog content
          </h2>
          <p className="mt-1 break-all text-[11px] text-slate-500">{url}</p>
          {panelError ? (
            <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
              {panelError}
            </p>
          ) : null}
          <label className="mt-3 block">
            <span className="mb-1 block text-[11px] font-medium text-slate-600">
              Title
            </span>
            <input
              autoFocus
              value={pasteTitle}
              onChange={(e) => setPasteTitle(e.target.value)}
              placeholder="Article title"
              className="w-full rounded-md border border-[#e5e7eb] bg-white px-2.5 py-1.5 text-[12px] text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
          </label>
          <label className="mt-2 block">
            <span className="mb-1 block text-[11px] font-medium text-slate-600">
              Report body / summary
            </span>
            <textarea
              value={pasteBody}
              onChange={(e) => setPasteBody(e.target.value)}
              rows={7}
              placeholder="Paste the article body or a summary..."
              className="w-full resize-y rounded-md border border-[#e5e7eb] bg-white px-2.5 py-1.5 text-[12px] text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
          </label>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setPanelError(null);
                setPanel("choice");
              }}
              className="text-[11px] text-slate-500 hover:text-slate-700"
            >
              Back
            </button>
            <button
              type="button"
              onClick={submitPaste}
              disabled={pending}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-slate-700 disabled:opacity-60"
            >
              {pending ? "Importing..." : "Import"}
            </button>
          </div>
        </Modal>
      ) : null}

      {imported ? (
        <ReportModal
          report={imported}
          onClose={() => {
            setImported(null);
            router.refresh();
          }}
        />
      ) : null}

      {toast ? (
        <div
          role="status"
          className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-md border px-3 py-2 text-[12px] shadow-lg ${
            toast.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          <div className="flex items-start gap-2">
            <span className="flex-1">{toast.text}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss"
              className="text-slate-400 hover:text-slate-600"
            >
              x
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-[#e5e7eb] bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
