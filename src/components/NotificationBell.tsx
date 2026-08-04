"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import Link from "next/link";
import {
  markAllNotificationsRead,
  markNotificationsRead,
  pollNotifications,
} from "@/app/notification-actions";
import { useRouter } from "next/navigation";
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
  // A lightning bolt: exploitation just became practical.
  poc_released: "M13 2 3 14h9l-1 8 10-12h-9l1-8z",
  new_user: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6",
};

// How often to look for new notifications. A minute is well inside the useful
// latency for anything here - an ingest takes minutes - and the query behind it
// is one indexed read.
const POLL_MS = 60_000;

// A burst (an ingest finishing raises several at once) should not throw a stack
// of system pop-ups. Past this, one notification says how many there are.
const MAX_DESKTOP_POPUPS = 3;

type Permission = NotificationPermission | "unsupported";

// Browser permission is external state, so it is read rather than mirrored into
// a state variable: mirroring means either a hydration mismatch (the server
// cannot know it) or a synchronous setState in an effect. Only our own request
// can change it, so that is the one thing that has to tell React.
const permissionListeners = new Set<() => void>();
function subscribePermission(onChange: () => void): () => void {
  permissionListeners.add(onChange);
  return () => permissionListeners.delete(onChange);
}
function readPermission(): Permission {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}
/** The server has no browser permission to report. */
function serverPermission(): Permission {
  return "default";
}

/** Kinds that report something wrong, and are worth colouring as such. */
const ALERT_KINDS = new Set([
  "stale_feeds",
  "ingest_errors",
  "suspect_iocs",
  // Not a fault, but the one item here that may need acting on today.
  "poc_released",
]);

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
  const router = useRouter();
  const permission = useSyncExternalStore(
    subscribePermission,
    readPermission,
    serverPermission,
  );
  // The newest notification already accounted for. Polling asks for anything
  // after this, so nothing is fetched twice and nothing is missed between polls.
  const sinceRef = useRef<string>(
    initial[0]?.createdAt ?? new Date(0).toISOString(),
  );
  // Desktop pop-ups only for what arrives while the page is open. Without this,
  // the first poll after a reload would re-announce everything already read.
  const announcedRef = useRef<Set<string>>(new Set(initial.map((n) => n.id)));

  const showDesktop = useCallback(
    (fresh: NotificationItem[]) => {
      if (typeof window === "undefined" || !("Notification" in window)) return;
      if (Notification.permission !== "granted" || fresh.length === 0) return;

      const show = fresh.slice(0, MAX_DESKTOP_POPUPS);
      for (const n of show) {
        // tag collapses a repeat of the same notification rather than stacking
        // it, which matters when several tabs are open on the same account.
        const popup = new Notification(n.title, {
          body: n.body ?? undefined,
          tag: n.id,
          icon: "/favicon.ico",
        });
        popup.onclick = () => {
          window.focus();
          if (n.href) router.push(n.href);
          popup.close();
        };
      }
      const extra = fresh.length - show.length;
      if (extra > 0) {
        new Notification(`${extra} more notification${extra === 1 ? "" : "s"}`, {
          tag: "palantish-overflow",
        });
      }
    },
    [router],
  );

  const refresh = useCallback(() => {
    startTransition(async () => {
      const res = await pollNotifications(sinceRef.current);
      if (res.items.length > 0) {
        sinceRef.current = res.items[0].createdAt;
        setItems((cur) => {
          const known = new Set(cur.map((n) => n.id));
          const added = res.items.filter((n) => !known.has(n.id));
          return added.length ? [...added, ...cur] : cur;
        });
        const unannounced = res.items.filter(
          (n) => !announcedRef.current.has(n.id),
        );
        for (const n of unannounced) announcedRef.current.add(n.id);
        showDesktop(unannounced);
      }
      // Always taken from the server: read state changes in another tab should
      // be reflected here even when nothing new has arrived.
      setUnread(res.unread);
    });
  }, [showDesktop]);

  // Poll on a timer, and immediately whenever the tab is brought back - coming
  // back to a stale badge is the case people actually notice.
  useEffect(() => {
    const timer = setInterval(refresh, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  async function askPermission() {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    // Requested from a click, never on load: browsers ignore (and users resent)
    // an unprompted permission dialog.
    await Notification.requestPermission();
    for (const listener of permissionListeners) listener();
  }

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

          {permission === "default" ? (
            <button
              type="button"
              onClick={askPermission}
              className="flex w-full items-center gap-1.5 border-b border-slate-100 bg-blue-50/60 px-3 py-1.5 text-left text-[11px] text-[#1d4ed8] hover:bg-blue-50"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
              </svg>
              Also show these on your desktop
            </button>
          ) : permission === "denied" ? (
            <p className="border-b border-slate-100 px-3 py-1.5 text-[10px] text-slate-400">
              Desktop notifications are blocked for this site in your browser.
            </p>
          ) : null}

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
