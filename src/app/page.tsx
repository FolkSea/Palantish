import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadDashboard } from "@/lib/data";
import CompiledTime from "@/components/CompiledTime";
import { ImportPostButton } from "@/components/ImportPostButton";
import { SearchPanel } from "@/components/SearchPanel";
import ActivityTimeline from "@/components/ActivityTimeline";
import { DEFAULT_FILTERS, type TimelineFilters } from "@/lib/timeline";
import { ExecutiveSummaryPanel } from "@/components/ExecutiveSummary";
import { StaleFeedsPanel } from "@/components/StaleFeedsPanel";
import { Ticker, Footnote } from "@/components/DashboardSections";
import { ActivityByActor } from "@/components/ActivityByActor";
import type { Focus } from "@/components/settings/AccountPanel";
import {
  VulnTable,
  BreachTable,
  ReportsList,
} from "@/components/PaginatedSections";

// Always render fresh intel; never cache the authenticated dashboard.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const data = await loadDashboard();

  const displayName = (
    user?.user_metadata?.display_name as string | undefined
  )?.trim();
  const identityLabel = displayName || user?.email;
  const focus = ((user?.user_metadata?.focus as string | undefined) ??
    "all") as Focus;
  const savedFilters = user?.user_metadata?.timelineFilters as
    | Partial<TimelineFilters>
    | undefined;
  const timelineFilters: TimelineFilters = { ...DEFAULT_FILTERS, ...savedFilters };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* Header */}
      <header className="mb-4 rounded-lg bg-[#2855D9] px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* Stylised P with a dot in the loop (the all-seeing stone) */}
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm">
              <svg
                width="22"
                height="22"
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
              <h1 className="text-[22px] font-bold lowercase leading-none tracking-tight text-white">
                palantish
              </h1>
              <p className="mt-1 text-[12px] text-[#90A9FF]">
                Open Source Intelligence Portal
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#90A9FF]">{identityLabel}</span>
            <ImportPostButton />
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="rounded-md bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-blue-50"
              >
                Sign out
              </button>
            </form>
            <Link
              href="/settings"
              aria-label="Settings"
              title="Settings"
              className="rounded-md bg-white p-1.5 text-slate-700 hover:bg-blue-50"
            >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-[#90A9FF]">
          <CompiledTime iso={data.compiledAt} />
        </p>
      </header>

      {/* Search */}
      <div className="mb-4">
        <SearchPanel />
      </div>

      {/* Breaking ticker (last 24h only; hidden when empty) */}
      {data.breaking.length > 0 ? (
        <div className="mb-4">
          <Ticker items={data.breaking} />
        </div>
      ) : null}

      {/* Executive summary */}
      <div className="mb-4">
        <ExecutiveSummaryPanel summary={data.executiveSummary} />
      </div>

      <div className="space-y-4">
        {/* Unified activity timeline (one lane per adversary) */}
        <ActivityTimeline
          events={data.timeline.events}
          streams={data.timeline.streams}
          initialFilters={timelineFilters}
        />

        {/* Actor cards */}
        <ActivityByActor
          nationStateCards={data.nationStateCards}
          ecrimeCards={data.ecrimeCards}
          hacktivismCards={data.hacktivismCards}
          focus={focus}
        />

        {/* Paginated sections, each full width */}
        <VulnTable rows={data.vulnerabilities} />
        <BreachTable rows={data.breaches} />
        <ReportsList items={data.reports} />

        {/* Footnote */}
        <Footnote />

        {/* Potentially stale feeds warning */}
        <StaleFeedsPanel feeds={data.staleFeeds} />
      </div>
    </div>
  );
}
