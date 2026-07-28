import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { buildGroupsFromAdversaries } from "@/lib/ingest/adversaries";
import { buildEcrimeActorGroups, deriveEcrimeActor } from "@/lib/ecrime";
import { isThreatIntel } from "@/lib/relevance";

type Tables = Database["public"]["Tables"];
type Views = Database["public"]["Views"];

export type ActorRow = Tables["actors"]["Row"];
export type IntelItemRow = Tables["intel_items"]["Row"];
export type VulnerabilityRow = Tables["vulnerabilities"]["Row"];
export type BreachRow = Tables["breaches"]["Row"];
export type TimelineRow = Views["timeline_events"]["Row"];

export type ActorWithItems = ActorRow & { items: IntelItemRow[] };

export type EcrimeTimelinePoint = {
  id: string;
  actor: string;
  date: string;
  title: string;
  summary: string | null;
  source: string | null;
  url: string | null;
};

export type VulnTimelinePoint = {
  id: string;
  status: "confirmed" | "poc" | "suspected";
  date: string;
  cveId: string;
  target: string | null;
  detail: string | null;
  url: string | null;
};

export type ExecutiveSummary = {
  summary: string;
  source: string;
  model: string | null;
  generatedAt: string;
};

export type StaleFeed = {
  name: string;
  category: string;
  lastItemAt: string | null;
  lastError: string | null;
};

export type DashboardData = {
  compiledAt: string | null;
  executiveSummary: ExecutiveSummary | null;
  actors: ActorWithItems[];
  timeline: TimelineRow[];
  ecrimeTimeline: EcrimeTimelinePoint[];
  vulnTimeline: VulnTimelinePoint[];
  breaking: IntelItemRow[];
  reports: IntelItemRow[];
  vulnerabilities: VulnerabilityRow[];
  breaches: BreachRow[];
  ecrime: BreachRow[];
  staleFeeds: StaleFeed[];
};

// Number of eCrime items surfaced in the "most significant eCrime" actor card.
const ECRIME_CARD_LIMIT = 6;

/**
 * Loads every section of the dashboard in parallel. All queries run under the
 * caller's RLS context, so only allow-listed authenticated users see data.
 */
// Timeline tabs look back 30 days; every non-timeline section shows 7 days.
const RECENT_DAYS = 7;
const TIMELINE_DAYS = 30;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export async function loadDashboard(): Promise<DashboardData> {
  const supabase = await createClient();
  const recentCutoff = daysAgo(RECENT_DAYS);
  const timelineCutoff = daysAgo(TIMELINE_DAYS);
  // Breaking ticker shows only the freshest items (last ~24h). published_at is
  // date-granular, so this is a 1-day date cutoff.
  const breakingCutoff = daysAgo(1);
  const staleCutoff = new Date(
    Date.now() - TIMELINE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [
    actorsRes,
    activityRes,
    timelineRes,
    breakingRes,
    reportsRes,
    vulnsRes,
    breachesRes,
    ecrimeAdvRes,
    summaryRes,
    staleFeedsRes,
    refreshRes,
  ] = await Promise.all([
    supabase.from("actors").select("*").order("sort_order"),
    supabase
      .from("intel_items")
      .select("*")
      .eq("item_type", "actor_activity")
      .gte("published_at", recentCutoff)
      .order("published_at", { ascending: false }),
    // Nation-state timeline: 30-day window (the view enforces the range).
    supabase
      .from("timeline_events")
      .select("*")
      .order("published_at", { ascending: true }),
    supabase
      .from("intel_items")
      .select("*")
      .eq("item_type", "breaking")
      .gte("published_at", breakingCutoff)
      .order("published_at", { ascending: false })
      .limit(10),
    supabase
      .from("intel_items")
      .select("*")
      .eq("item_type", "report")
      .gte("published_at", recentCutoff)
      .order("published_at", { ascending: false }),
    // 30-day window for the vulns tab; the table slices this to 7 days below.
    supabase
      .from("vulnerabilities")
      .select("*")
      .gte("added_at", timelineCutoff)
      .order("added_at", { ascending: false }),
    // 30-day window for the eCrime tab; the table/card slice to 7 days below.
    supabase
      .from("breaches")
      .select("*")
      .gte("event_date", timelineCutoff)
      .order("event_date", { ascending: false, nullsFirst: false }),
    // eCrime adversary aliases (CrowdStrike cryptonyms) for attribution.
    supabase
      .from("adversaries")
      .select(
        "name, animal_classifier, description, short_description, motivation, community_identifiers, internal_alternative_names",
      )
      .eq("nexus", "other"),
    supabase
      .from("executive_summaries")
      .select("summary, source, model, generated_at")
      .order("generated_at", { ascending: false })
      .limit(1),
    // Active feeds whose newest item is older than 30 days (or never seen).
    supabase
      .from("sources")
      .select("name, category, last_item_at, last_error")
      .eq("active", true)
      .not("feed_url", "is", null)
      .or(`last_item_at.is.null,last_item_at.lt.${staleCutoff}`)
      .order("last_item_at", { ascending: true, nullsFirst: true }),
    supabase
      .from("refresh_runs")
      .select("finished_at, started_at")
      .eq("status", "success")
      .order("started_at", { ascending: false })
      .limit(1),
  ]);

  // Items the current user has hidden (RLS scopes this query to their own rows).
  const { data: hiddenRows } = await supabase
    .from("hidden_items")
    .select("raw_hash");
  const hidden = new Set((hiddenRows ?? []).map((r) => r.raw_hash));

  // Keep only genuine threat-intel posts across the dashboard (drop marketing,
  // corporate/business news, event promos, podcasts, and lifestyle content),
  // and drop anything this user has hidden.
  const keep = (i: { title: string | null; description?: string | null; raw_hash: string }) =>
    isThreatIntel(i.title, i.description) && !hidden.has(i.raw_hash);
  const activity = (activityRes.data ?? []).filter(keep);
  const actors: ActorWithItems[] = (actorsRes.data ?? []).map((actor) => ({
    ...actor,
    items: activity.filter((i) => i.actor_id === actor.id),
  }));

  const latestRefresh = refreshRes.data?.[0];
  const compiledAt =
    latestRefresh?.finished_at ?? latestRefresh?.started_at ?? null;

  const summaryRow = summaryRes.data?.[0];
  const executiveSummary: ExecutiveSummary | null = summaryRow
    ? {
        summary: summaryRow.summary,
        source: summaryRow.source,
        model: summaryRow.model,
        generatedAt: summaryRow.generated_at,
      }
    : null;

  // eCrime attribution matcher (catalogue CrowdStrike names + known crews).
  const ecrimeGroups = buildEcrimeActorGroups(
    buildGroupsFromAdversaries(ecrimeAdvRes.data ?? []),
  );

  const breaches30 = (breachesRes.data ?? []).filter(
    (b) => isThreatIntel(b.org_name, b.summary) && !hidden.has(b.raw_hash),
  );
  const breaches = breaches30.filter((b) => (b.event_date ?? "") >= recentCutoff);
  const ecrimeTimeline: EcrimeTimelinePoint[] = breaches30
    .filter((b) => b.event_date)
    .map((b) => ({
      id: b.id,
      actor: deriveEcrimeActor(`${b.org_name} ${b.summary ?? ""}`, ecrimeGroups),
      date: b.event_date as string,
      title: b.org_name,
      summary: b.summary,
      source: b.source_name,
      url: b.url,
    }));

  const vulns30 = vulnsRes.data ?? [];
  const vulnerabilities = vulns30.filter(
    (v) => (v.added_at ?? "") >= recentCutoff,
  );
  const vulnTimeline: VulnTimelinePoint[] = vulns30
    .filter((v) => v.added_at)
    .map((v) => ({
      id: v.id,
      status: v.status,
      date: v.added_at as string,
      cveId: v.cve_id,
      target: v.target,
      detail: v.detail,
      url: v.url,
    }));

  return {
    compiledAt,
    executiveSummary,
    actors,
    timeline: timelineRes.data ?? [],
    ecrimeTimeline,
    vulnTimeline,
    breaking: (breakingRes.data ?? []).filter(keep),
    reports: (reportsRes.data ?? []).filter(keep),
    vulnerabilities,
    breaches,
    // The most significant recent eCrime activity (ransomware / extortion /
    // large-scale breaches) surfaced as its own actor card.
    ecrime: breaches.slice(0, ECRIME_CARD_LIMIT),
    staleFeeds: (staleFeedsRes.data ?? []).map((s) => ({
      name: s.name,
      category: s.category,
      lastItemAt: s.last_item_at,
      lastError: s.last_error,
    })),
  };
}
