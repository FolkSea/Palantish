import { getAuthenticatedClient } from "@/lib/auth";
import { loadDashboard } from "@/lib/data";
import { SiteHeader } from "@/components/SiteHeader";
import { readingPrefsFrom } from "@/lib/reading-prefs";
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
  const auth = await getAuthenticatedClient();
  const user = auth?.user;

  const data = await loadDashboard();
  // Dynamic server render: capture one clock value and pass it into the client
  // chart so its memoised bounds stay deterministic across re-renders.
  // eslint-disable-next-line react-hooks/purity
  const timelineNow = Date.now();

  const focus = ((user?.user_metadata?.focus as string | undefined) ??
    "all") as Focus;
  const savedFilters = user?.user_metadata?.timelineFilters as
    | Partial<TimelineFilters>
    | undefined;
  const timelineFilters: TimelineFilters = { ...DEFAULT_FILTERS, ...savedFilters };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <SiteHeader />

      {data.breaking.length > 0 ? (
        <div className="mb-4">
          <Ticker items={data.breaking} />
        </div>
      ) : null}

      <div className="mb-4">
        <ExecutiveSummaryPanel
          summary={data.executiveSummary}
          reading={readingPrefsFrom(user?.user_metadata)}
        />
      </div>

      <div className="space-y-4">
        <ActivityTimeline
          events={data.timeline.events}
          streams={data.timeline.streams}
          initialFilters={timelineFilters}
          now={timelineNow}
        />

        <ActivityByActor
          nationStateCards={data.nationStateCards}
          ecrimeCards={data.ecrimeCards}
          hacktivismCards={data.hacktivismCards}
          focus={focus}
        />

        <VulnTable rows={data.vulnerabilities} />
        <BreachTable rows={data.breaches} />
        <ReportsList items={data.reports} />

        <Footnote />

        <StaleFeedsPanel feeds={data.staleFeeds} />
      </div>
    </div>
  );
}
