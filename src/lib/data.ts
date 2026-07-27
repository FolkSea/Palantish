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
export async function loadDashboard(): Promise<DashboardData> {
  const supabase = await createClient();

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
      .order("published_at", { ascending: false }),
    supabase
      .from("timeline_events")
      .select("*")
      .order("published_at", { ascending: true }),
    supabase
      .from("intel_items")
      .select("*")
      .eq("item_type", "breaking")
      .order("published_at", { ascending: false })
      .limit(10),
    supabase
      .from("intel_items")
      .select("*")
      .eq("item_type", "report")
      .order("published_at", { ascending: false }),
    supabase
      .from("vulnerabilities")
      .select("*")
      .order("added_at", { ascending: false }),
    supabase
      .from("breaches")
      .select("*")
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
