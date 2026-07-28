import { createClient } from "@/lib/supabase/server";
import { loadDashboard } from "@/lib/data";
import CompiledTime from "@/components/CompiledTime";
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
        <form
          action="/auth/signout"
          method="post"
          className="flex items-center gap-2"
        >
          <span className="text-[11px] text-slate-400">{user?.email}</span>
          <button
            type="submit"
            className="rounded-md border border-[#e5e7eb] bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
          >
            Sign out
          </button>
        </form>
      </header>

      {/* Executive summary */}
      <div className="mb-4">
        <ExecutiveSummaryPanel summary={data.executiveSummary} />
      </div>

      {/* Breaking ticker */}
      <div className="mb-4">
        <Ticker items={data.breaking} />
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
