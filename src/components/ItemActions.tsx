"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteItemAction, hideItemAction } from "@/app/actions";
import { BookmarkToggle, ShareButton } from "@/components/ItemControls";

/**
 * The per-item control cluster on a list row or an actor card: save to the
 * reading list, copy a link, hide for me, delete for everyone. Hide is per-user
 * (persisted); delete removes the item for everyone and blocklists it from
 * re-import. Both refresh the dashboard so the item drops out of the list.
 */
export function ItemActions({
  rawHash,
  intelItemId,
}: {
  rawHash: string;
  /** Enables the save control; omitted where the row has no id to hand. */
  intelItemId?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function hide() {
    setError(null);
    startTransition(async () => {
      const r = await hideItemAction(rawHash);
      if (r.ok) router.refresh();
      else setError(r.error ?? "Failed to hide.");
    });
  }

  function remove() {
    if (
      !window.confirm(
        "Delete this item permanently? It will be removed for everyone and will not be re-imported.",
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const r = await deleteItemAction(rawHash);
      if (r.ok) router.refresh();
      else setError(r.error ?? "Failed to delete.");
    });
  }

  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {intelItemId ? <BookmarkToggle intelItemId={intelItemId} /> : null}
      <ShareButton rawHash={rawHash} />
      <button
        type="button"
        onClick={hide}
        disabled={pending}
        aria-label="Hide for me"
        title="Hide for me"
        className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
      >
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
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        aria-label="Delete permanently"
        title="Delete permanently (all users)"
        className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
      >
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
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
      </button>
      {error ? <span className="text-[10px] text-red-600">{error}</span> : null}
    </span>
  );
}
