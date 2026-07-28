"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importPostAction } from "@/app/actions";

function truncate(s: string, n = 70): string {
  return s.length > n ? `${s.slice(0, n - 1)}...` : s;
}

export function ImportPostButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  function onClick() {
    const url = window.prompt(
      "Paste the blog post / article URL to import:",
    );
    if (!url || !url.trim()) return;
    setToast(null);
    startTransition(async () => {
      const res = await importPostAction(url.trim());
      if (res.ok) {
        const added = res.sourceCreated
          ? ` New source added: ${res.sourceName}.`
          : "";
        setToast({
          kind: "ok",
          text: `Imported "${truncate(res.title)}" as ${res.route}.${added}`,
        });
        router.refresh();
      } else {
        setToast({ kind: "err", text: res.error });
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        title="Import a blog post by URL"
        className="rounded-md border border-[#e5e7eb] bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? "Importing..." : "Import post"}
      </button>

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
