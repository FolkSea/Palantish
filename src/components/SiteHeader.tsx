import Link from "next/link";
import { getAuthenticatedClient, isAdministrator } from "@/lib/auth";
import { loadCompiledAt } from "@/lib/data";
import CompiledTime from "@/components/CompiledTime";
import { HeaderMenu } from "@/components/HeaderMenu";
import { HeaderNav } from "@/components/HeaderNav";
import { NotificationBell } from "@/components/NotificationBell";
import { loadNotifications } from "@/lib/notifications/read";
import { SearchPanel } from "@/components/SearchPanel";

/**
 * The application header, on every page. The mark and wordmark are the way home
 * - which is why no page carries a "back to dashboard" button.
 *
 * Loads its own identity and compiled time rather than taking them as props, so
 * adding it to a page is one line and every page shows the same thing.
 */
export async function SiteHeader() {
  const auth = await getAuthenticatedClient();
  const user = auth?.user;
  const compiledAt = await loadCompiledAt();
  // Loaded here rather than per page: the bell is part of the header, and every
  // page would otherwise have to remember to fetch for it.
  const notifications = auth
    ? await loadNotifications(auth.supabase)
    : { items: [], unread: 0 };

  const displayName = (
    user?.user_metadata?.display_name as string | undefined
  )?.trim();
  const identityLabel = displayName || user?.email;

  return (
    <header className="mb-4 rounded-lg bg-[#2855D9] px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-md outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-white/60"
          aria-label="Palantish home"
        >
          {/* Stylised P with a dot in the loop (the all-seeing stone) */}
          <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-lg bg-white shadow-sm">
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M8 20.5 V3.5 H13 a5 5 0 0 1 0 10 H8"
                stroke="#2855D9"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="12.5" cy="8.5" r="1.8" fill="#2855D9" />
            </svg>
          </span>
          <div>
            <h1 className="text-[26px] font-bold lowercase leading-none tracking-tight text-white">
              palantish
            </h1>
            <p className="mt-1 whitespace-nowrap text-[12px] leading-tight text-[#90A9FF]">
              Open Source Intelligence Portal
            </p>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          <HeaderNav />
          <span className="text-[11px] text-[#90A9FF]">{identityLabel}</span>
          <NotificationBell
            initial={notifications.items}
            initialUnread={notifications.unread}
          />
          <HeaderMenu
            isAdministrator={auth ? isAdministrator(auth.role) : false}
          />
        </div>
      </div>
      {/* Search sits in the header so it is on every page, and its results
          float over the page rather than pushing it down. */}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <div className="min-w-[240px] flex-1">
          <SearchPanel />
        </div>
        <p className="shrink-0 text-[11px] text-[#90A9FF]">
          <CompiledTime iso={compiledAt} />
        </p>
      </div>
    </header>
  );
}
