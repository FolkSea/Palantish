"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { unhideItemAction } from "@/app/actions";
import { usePaginated, PaginationFooter } from "@/components/Pagination";
import { formatDate } from "@/lib/format";

export type HiddenPost = {
  rawHash: string;
  title: string | null;
  url: string | null;
  sourceName: string | null;
  publishedAt: string | null;
  hiddenAt: string;
};

export function HiddenPanel({ initialHidden }: { initialHidden: HiddenPost[] }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(initialHidden);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const p = usePaginated(hidden, 25);

  function unhide(rawHash: string) {
    setBusy(rawHash);
    setError(null);
    startTransition(async () => {
      const r = await unhideItemAction(rawHash);
      setBusy(null);
      if (!r.ok) {
        setError(r.error ?? "Failed to unhide.");
        return;
      }
      setHidden((prev) => prev.filter((h) => h.rawHash !== rawHash));
      router.refresh();
    });
  }

  return (
    <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-4">
      <h2 className="text-[13px] font-semibold text-slate-900">
        Hidden posts ({hidden.length})
      </h2>
      <p className="mt-0.5 text-[11px] text-slate-500">
        Posts you have hidden from your dashboard. Unhiding restores them for you
        only.
      </p>

      {error ? (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          {error}
        </p>
      ) : null}

      {hidden.length === 0 ? (
        <p className="mt-4 text-[12px] text-slate-400">
          You have not hidden any posts.
        </p>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-slate-100">
            {p.pageItems.map((h) => (
              <li
                key={h.rawHash}
                className="flex items-start gap-3 py-2 text-[12px]"
              >
                <span className="flex-1">
                  {h.url ? (
                    <a
                      href={h.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-slate-800 hover:underline"
                    >
                      {h.title ?? h.url}
                    </a>
                  ) : (
                    <span className="font-medium text-slate-800">
                      {h.title ?? "(item no longer available)"}
                    </span>
                  )}
                  <span className="mt-0.5 block text-[11px] text-slate-400">
                    {h.sourceName ? `${h.sourceName} - ` : ""}
                    {h.publishedAt ? formatDate(h.publishedAt) : ""}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => unhide(h.rawHash)}
                  disabled={pending && busy === h.rawHash}
                  className="shrink-0 rounded border border-[#e5e7eb] bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  {pending && busy === h.rawHash ? "..." : "Unhide"}
                </button>
              </li>
            ))}
          </ul>
          <PaginationFooter {...p} />
        </>
      )}
    </section>
  );
}
