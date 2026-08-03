"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBookmarkAction } from "@/app/bookmark-actions";
import { useBookmarks } from "@/components/BookmarksProvider";

/**
 * Add or remove this report from the reader's own reading list.
 *
 * The icon flips immediately and rolls back if the write fails, so the button
 * never claims a state the server did not accept - a bookmark that silently did
 * not save is worse than one that visibly refused.
 */
export function BookmarkButton({
  intelItemId,
  initial,
}: {
  intelItemId: string;
  initial: boolean;
}) {
  const router = useRouter();
  const bookmarks = useBookmarks();
  // Falls back to its own state outside a provider, so the button still works
  // if the report view is ever rendered on its own.
  const [local, setLocal] = useState(initial);
  const on = bookmarks ? bookmarks.has(intelItemId) : local;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    setError(null);
    startTransition(async () => {
      if (bookmarks) {
        const r = await bookmarks.toggle(intelItemId);
        if (r.ok) router.refresh();
        else setError(r.error ?? "Could not save.");
        return;
      }
      const next = !local;
      setLocal(next);
      const r = await setBookmarkAction(intelItemId, next);
      if (r.ok) router.refresh();
      else {
        setLocal(!next);
        setError(r.error);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={on}
      title={
        error ??
        (on ? "Remove from your reading list" : "Save to your reading list")
      }
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium disabled:opacity-60 ${
        on
          ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
          : "border-[#e5e7eb] bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        // Filled when saved, outline when not: the state is legible at a glance
        // rather than only from the colour.
        fill={on ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
      {on ? "Saved" : "Save"}
    </button>
  );
}
