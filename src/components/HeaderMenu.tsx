"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImportPostButton } from "./ImportPostButton";
import { ingestAllSources, refreshSummaryAction } from "@/app/settings/actions";

type Toast = { kind: "ok" | "err"; text: string };

/**
 * The header actions collapsed into one hamburger menu: import a single report,
 * refresh all feeds, refresh the executive summary, open Settings, and log out.
 * ImportPostButton is rendered outside the dropdown (kept mounted) and opened
 * via a signal so its import modal survives the menu closing.
 */
export function HeaderMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [importSignal, setImportSignal] = useState(0);
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<Toast | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function refreshFeeds() {
    setOpen(false);
    setToast(null);
    startTransition(async () => {
      const res = await ingestAllSources();
      setToast(
        res.ok
          ? {
              kind: "ok",
              text: res.started
                ? "Refresh started - new items will appear as they are processed. Reload to see progress."
                : `Feeds refreshed${
                    typeof res.itemsAdded === "number"
                      ? ` - ${res.itemsAdded} new item${res.itemsAdded === 1 ? "" : "s"}`
                      : ""
                  }.`,
            }
          : { kind: "err", text: res.error ?? "Refresh failed." },
      );
      router.refresh();
    });
  }

  function refreshSummary() {
    setOpen(false);
    setToast(null);
    startTransition(async () => {
      const res = await refreshSummaryAction();
      setToast(
        res.ok
          ? { kind: "ok", text: "Executive summary refreshed." }
          : { kind: "err", text: res.error ?? "Refresh failed." },
      );
      router.refresh();
    });
  }

  const itemCls =
    "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-slate-700 hover:bg-slate-50 disabled:opacity-50";

  return (
    <div className="relative" ref={ref}>
      {/* Kept mounted so the import modal survives the menu/trigger unmounting. */}
      <ImportPostButton openSignal={importSignal} trigger={() => null} />

      <button
        type="button"
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded-md bg-white p-1.5 text-slate-700 hover:bg-blue-50"
      >
        {pending ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            className="animate-spin text-slate-500"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        )}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-md border border-[#e5e7eb] bg-white py-1 text-slate-700 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            className={itemCls}
            onClick={() => {
              setOpen(false);
              setImportSignal((s) => s + 1);
            }}
          >
            <MenuIcon d="M12 5v14M5 12h14" /> Import Single Report
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemCls}
            disabled={pending}
            onClick={refreshFeeds}
          >
            <MenuIcon d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
            Refresh all Feeds
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemCls}
            disabled={pending}
            onClick={refreshSummary}
          >
            <MenuIcon d="M4 5h16M4 12h16M4 19h10" /> Refresh Summary
          </button>
          <Link
            href="/settings"
            role="menuitem"
            className={itemCls}
            onClick={() => setOpen(false)}
          >
            <MenuIcon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 0 1-4 0a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 0 1 0-4a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0a1.7 1.7 0 0 0 1 1.5a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.5 2.9H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            Settings
          </Link>
          <div className="my-1 border-t border-slate-100" />
          <form action="/auth/signout" method="post">
            <button type="submit" role="menuitem" className={itemCls}>
              <MenuIcon d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              Logout
            </button>
          </form>
        </div>
      ) : null}

      {toast ? (
        <div
          className={`absolute right-0 z-50 mt-1 w-64 rounded-md border px-3 py-2 text-[11px] shadow-lg ${
            toast.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          <span className="flex items-start justify-between gap-2">
            <span>{toast.text}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss"
              className="shrink-0 text-slate-400 hover:text-slate-600"
            >
              x
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function MenuIcon({ d }: { d: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-slate-400"
    >
      <path d={d} />
    </svg>
  );
}
