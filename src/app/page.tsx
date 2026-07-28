import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadDashboard } from "@/lib/data";
import CompiledTime from "@/components/CompiledTime";
import { ImportPostButton } from "@/components/ImportPostButton";
import TimelineTabs from "@/components/TimelineTabs";
import { ExecutiveSummaryPanel } from "@/components/ExecutiveSummary";
import { StaleFeedsPanel } from "@/components/StaleFeedsPanel";
import { Ticker, ActorGrid, Footnote } from "@/components/DashboardSections";
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* Header */}
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-slate-900">
            Nation-State Cyber Intelligence Dashboard
          </h1>
          <p className="mt-0.5 max-w-2xl text-[12px] text-slate-500">
            Tracking state-nexus cyber activity, actively exploited
            vulnerabilities, reported breaches, and new vendor and government
            reporting.
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            <CompiledTime iso={data.compiledAt} />
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">{identityLabel}</span>
          <ImportPostButton />
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="rounded-md border border-[#e5e7eb] bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
            >
              Sign out
            </button>
          </form>
          <Link
            href="/settings"
            aria-label="Settings"
            title="Settings"
            className="rounded-md border border-[#e5e7eb] bg-white p-1.5 text-slate-600 hover:bg-slate-50"
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
      </header>

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
        {/* Tabbed activity timeline */}
        <TimelineTabs
          timeline={data.timeline}
          ecrimeTimeline={data.ecrimeTimeline}
          vulnTimeline={data.vulnTimeline}
        />

        {/* Actor cards */}
        <ActorGrid actors={data.actors} ecrime={data.ecrime} />

        {/* Vulns + breaches side by side on wide screens */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <VulnTable rows={data.vulnerabilities} />
          <BreachTable rows={data.breaches} />
        </div>

        {/* Newly released reporting */}
        <ReportsList items={data.reports} />

        {/* Footnote */}
        <Footnote />

        {/* Potentially stale feeds warning */}
        <StaleFeedsPanel feeds={data.staleFeeds} />
      </div>
    </div>
  );
}
