"use client";

import { useState, useTransition } from "react";
import { useBookmarks } from "@/components/BookmarksProvider";
import { itemHref } from "@/lib/browse-links";

/**
 * Save this report to the reading list. Compact icon form, for the control
 * cluster on a list row or an actor card; the report page uses the labelled
 * variant below.
 */
export function BookmarkToggle({ intelItemId }: { intelItemId: string }) {
  const bookmarks = useBookmarks();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!bookmarks) return null;

  const on = bookmarks.has(intelItemId);
  return (
    <button
      type="button"
      onClick={() => {
        setError(null);
        startTransition(async () => {
          const r = await bookmarks.toggle(intelItemId);
          if (!r.ok) setError(r.error ?? "Could not save.");
        });
      }}
      disabled={pending}
      aria-pressed={on}
      aria-label={on ? "Remove from reading list" : "Save to reading list"}
      title={error ?? (on ? "Remove from reading list" : "Save to reading list")}
      className={`rounded p-0.5 disabled:opacity-50 ${
        on
          ? "text-amber-600 hover:bg-amber-50"
          : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      }`}
    >
      <BookmarkIcon filled={on} />
    </button>
  );
}

/**
 * Copy a link to this report. Nothing is sent anywhere - the link goes to the
 * clipboard and the reader decides where it goes next.
 */
export function ShareButton({
  rawHash,
  label = false,
}: {
  rawHash: string;
  /** Show text beside the icon, for the report page header. */
  label?: boolean;
}) {
  const [note, setNote] = useState<"copied" | "failed" | null>(null);

  async function copy() {
    const href = itemHref(rawHash);
    if (href === "/") return;
    const url = `${window.location.origin}${href}`;
    try {
      await navigator.clipboard.writeText(url);
      setNote("copied");
    } catch {
      setNote("failed");
    }
    setTimeout(() => setNote(null), 2000);
  }

  const title =
    note === "copied"
      ? "Link copied"
      : note === "failed"
        ? "Could not copy - check clipboard permissions"
        : "Copy a link to this report";

  if (label) {
    return (
      <button
        type="button"
        onClick={copy}
        title={title}
        className="inline-flex items-center gap-1 rounded-md border border-[#e5e7eb] bg-white px-2 py-1 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
      >
        <ShareIcon />
        {note === "copied" ? "Copied" : "Share"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy a link to this report"
      title={title}
      className={`rounded p-0.5 ${
        note === "copied"
          ? "text-emerald-600"
          : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      }`}
    >
      <ShareIcon />
    </button>
  );
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      // Filled when saved: legible at a glance rather than only from colour.
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ShareIcon() {
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
    >
      <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}
