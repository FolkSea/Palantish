import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type Tables = Database["public"]["Tables"];
type Views = Database["public"]["Views"];

export type ActorRow = Tables["actors"]["Row"];
export type IntelItemRow = Tables["intel_items"]["Row"];
export type VulnerabilityRow = Tables["vulnerabilities"]["Row"];
export type BreachRow = Tables["breaches"]["Row"];
export type TimelineRow = Views["timeline_events"]["Row"];

export type ActorWithItems = ActorRow & { items: IntelItemRow[] };

export type DashboardData = {
  compiledAt: string | null;
  actors: ActorWithItems[];
  timeline: TimelineRow[];
  breaking: IntelItemRow[];
  reports: IntelItemRow[];
  vulnerabilities: VulnerabilityRow[];
  breaches: BreachRow[];
};

/**
 * Loads every section of the dashboard in parallel. All queries run under the
 * caller's RLS context, so only allow-listed authenticated users see data.
 */
// The timeline graph looks back 30 days (enforced by the timeline_events view).
// Every other section shows only the last 7 days.
const RECENT_DAYS = 7;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export async function loadDashboard(): Promise<DashboardData> {
  const supabase = await createClient();
  const recentCutoff = daysAgo(RECENT_DAYS);

  const [
    actorsRes,
    activityRes,
    timelineRes,
    breakingRes,
    reportsRes,
    vulnsRes,
    breachesRes,
    refreshRes,
  ] = await Promise.all([
    supabase.from("actors").select("*").order("sort_order"),
    supabase
      .from("intel_items")
      .select("*")
      .eq("item_type", "actor_activity")
      .gte("published_at", recentCutoff)
      .order("published_at", { ascending: false }),
    // Timeline: 30-day window (the view enforces the range).
    supabase
      .from("timeline_events")
      .select("*")
      .order("published_at", { ascending: true }),
    supabase
      .from("intel_items")
      .select("*")
      .eq("item_type", "breaking")
      .gte("published_at", recentCutoff)
      .order("published_at", { ascending: false })
      .limit(10),
    supabase
      .from("intel_items")
      .select("*")
      .eq("item_type", "report")
      .gte("published_at", recentCutoff)
      .order("published_at", { ascending: false }),
    supabase
      .from("vulnerabilities")
      .select("*")
      .gte("added_at", recentCutoff)
      .order("added_at", { ascending: false }),
    supabase
      .from("breaches")
      .select("*")
      .gte("event_date", recentCutoff)
      .order("event_date", { ascending: false, nullsFirst: false }),
    supabase
      .from("refresh_runs")
      .select("finished_at, started_at")
      .eq("status", "success")
      .order("started_at", { ascending: false })
      .limit(1),
  ]);

  const activity = activityRes.data ?? [];
  const actors: ActorWithItems[] = (actorsRes.data ?? []).map((actor) => ({
    ...actor,
    items: activity.filter((i) => i.actor_id === actor.id),
  }));

  const latestRefresh = refreshRes.data?.[0];
  const compiledAt =
    latestRefresh?.finished_at ?? latestRefresh?.started_at ?? null;

  return {
    compiledAt,
    actors,
    timeline: timelineRes.data ?? [],
    breaking: breakingRes.data ?? [],
    reports: reportsRes.data ?? [],
    vulnerabilities: vulnsRes.data ?? [],
    breaches: breachesRes.data ?? [],
  };
}
