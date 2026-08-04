"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  markAllNotificationsRead,
  markNotificationsRead,
} from "@/app/notification-actions";
import type { NotificationItem } from "@/lib/notifications/read";
import { formatDateTime } from "@/lib/format";

/** A glyph per kind, so the list is scannable without reading every line. */
const ICON: Record<string, string> = {
  subscription_match: "M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16M6 19a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  feeds_ingested: "M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16",
  feed_ingested: "M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16",
  summary_updated: "M4 5h16M4 12h16M4 19h10",
  stale_feeds: "M12 9v4M12 17h.01M10.3 4 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z",
  suspect_iocs: "M12 8v4M12 16h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  ingest_errors: "M12 8v4M12 16h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  new_user: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6",
};

/** Kinds that report something wrong, and are worth colouring as such. */
const ALERT_KINDS = new Set(["stale_feeds", "ingest_errors", "suspect_iocs"]);

export function NotificationBell({
  initial,
  initialUnread,
}: {
  initial: NotificationItem[];
  initialUnread: number;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(initial);
  const [unread, setUnread] = useState(initialUnread);
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  // Dismiss the way any popup should: click away, or press Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function markRead(id: string) {
    // Optimistic: the badge should drop the instant it is clicked, and a failed
    // write costs a stale badge until the next page load, not a lost report.
    setItems((cur) => cur.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnread((n) => Math.max(0, n - 1));
    startTransition(async () => {
      await markNotificationsRead([id]);
    });
  }

  function markAll() {
    setItems((cur) => cur.map((n) => ({ ...n, read: true })));
    setUnread(0);
    startTransition(async () => {
      await markAllNotificationsRead();
    });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={
          unread > 0 ? `Notifications (${unread} unread)` : "Notifications"
        }
        aria-expanded={open}
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-white outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/60"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-rose-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-40 mt-1 w-80 overflow-hidden rounded-md border border-[#e5e7eb] bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-[12px] font-semibold text-slate-800">
              Notifications
            </span>
            {unread > 0 ? (
              <button
                type="button"
                onClick={markAll}
                className="text-[11px] text-[#1d4ed8] hover:underline"
              >
                Mark all read
              </button>
            ) : null}
          </div>

          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12px] text-slate-400">
              Nothing yet.
            </p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto">
              {items.map((n) => {
                const body = (
                  <>
                    <span
                      className={`mt-0.5 shrink-0 ${
                        ALERT_KINDS.has(n.kind)
                          ? "text-amber-600"
                          : "text-slate-400"
                      }`}
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
                        <path d={ICON[n.kind] ?? ICON.summary_updated} />
                      </svg>
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12px] leading-snug text-slate-800">
                        {n.title}
                      </span>
                      {n.body ? (
                        <span className="block text-[11px] leading-snug text-slate-500">
                          {n.body}
                        </span>
                      ) : null}
                      <span className="mt-0.5 block text-[10px] text-slate-400">
                        {formatDateTime(n.createdAt)}
                      </span>
                    </span>
                    {!n.read ? (
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#2855D9]"
                        aria-label="Unread"
                      />
                    ) : null}
                  </>
                );
                const cls = `flex w-full items-start gap-2 px-3 py-2 text-left ${
                  n.read ? "bg-white" : "bg-blue-50/60"
                } hover:bg-slate-50`;
                return (
                  <li key={n.id} className="border-b border-slate-100 last:border-0">
                    {n.href ? (
                      <Link
                        href={n.href}
                        className={cls}
                        onClick={() => {
                          markRead(n.id);
                          setOpen(false);
                        }}
                      >
                        {body}
                      </Link>
                    ) : (
                      // Nowhere to go, but still something to acknowledge.
                      <button
                        type="button"
                        className={cls}
                        onClick={() => markRead(n.id)}
                      >
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
