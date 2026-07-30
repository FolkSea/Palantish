import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { buildGroupsFromAdversaries } from "@/lib/ingest/adversaries";
import { buildEcrimeActorGroups, deriveEcrimeActor } from "@/lib/ecrime";
import { isThreatIntel } from "@/lib/relevance";
import { adversaryLabel, type Nexus } from "@/lib/badges";
import { nexusForCountry } from "@/lib/actor-classify";
import {
  GROUP_TABLE,
  sortGroups,
  deriveAdversaryFromText,
} from "@/lib/ingest/enrich/rules";
import {
  buildActorSectionCards,
  buildHacktivismGroups,
  type ActorGroupCard,
} from "@/lib/actor-sections";

type Tables = Database["public"]["Tables"];
type Views = Database["public"]["Views"];

export type IntelItemRow = Tables["intel_items"]["Row"];
export type VulnerabilityRow = Tables["vulnerabilities"]["Row"];
export type BreachRow = Tables["breaches"]["Row"];
export type TimelineRow = Views["timeline_events"]["Row"];

// An actor-card item, with a display adversary name (CS cryptonym when set,
// otherwise a specific name derived from the item text).
export type ActorItem = IntelItemRow & { adversary: string | null };

// A nation-state card: one country (or "Non Attributed") and its items.
export type NationStateCard = {
  key: string;
  label: string;
  nexus: Nexus; // accent colour bucket
  items: ActorItem[];
};

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

export type SummaryCitation = {
  id: number;
  title: string;
  url: string | null;
  description: string | null;
  sourceName: string | null;
  date: string | null;
  rawHash: string | null;
};

export type ExecutiveSummary = {
  summary: string;
  source: string;
  model: string | null;
  generatedAt: string;
  citations: SummaryCitation[];
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
  // Nation-state actor cards (China, Russia, North Korea, Iran, Rest of World).
  nationStateCards: NationStateCard[];
  // Per-actor eCrime and hacktivism cards (each with an "Unattributed" card).
  ecrimeCards: ActorGroupCard[];
  hacktivismCards: ActorGroupCard[];
  timeline: TimelineRow[];
  ecrimeTimeline: EcrimeTimelinePoint[];
  vulnTimeline: VulnTimelinePoint[];
  breaking: IntelItemRow[];
  reports: IntelItemRow[];
  vulnerabilities: VulnerabilityRow[];
  breaches: BreachRow[];
  staleFeeds: StaleFeed[];
};

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
      .select("name, nexus, community_identifiers, internal_alternative_names")
      .eq("nexus", "other"),
    supabase
      .from("executive_summaries")
      .select("summary, source, model, generated_at, citations")
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
  // Every country-attributed item gets a label: the stored adversary_label if
  // present (so operator edits stick), otherwise a computed fallback - the
  // specific name, or "UNID <animal>" keyed by the actor's nexus (country-
  // specific for Rest of the World).
  const nsGroups = sortGroups(GROUP_TABLE);
  const activityBase = (activityRes.data ?? []).filter(keep);
  // Nation-state activity grouped into one card per country, plus a
  // "Non Attributed" card for nation-state items without a country.
  const nsByCountry = new Map<string, ActorItem[]>();
  for (const i of activityBase) {
    if (i.motivation !== "nation_state") continue;
    const item: ActorItem = {
      ...i,
      adversary:
        i.adversary_label ??
        adversaryLabel(
          i.crowdstrike_adversary ??
            deriveAdversaryFromText(i.title, i.description, nsGroups),
          nexusForCountry(i.country),
          `${i.title} ${i.description ?? ""}`,
        ),
    };
    const key = i.country ?? "";
    const arr = nsByCountry.get(key);
    if (arr) arr.push(item);
    else nsByCountry.set(key, [item]);
  }
  // Most-active country first; the "Non Attributed" card always sorts last.
  const nationStateCards: NationStateCard[] = [...nsByCountry.entries()]
    .map(([key, items]) => ({
      key: key || "__none__",
      label: key || "Non Attributed",
      nexus: key ? nexusForCountry(key) : ("other" as Nexus),
      items,
    }))
    .sort((a, b) => {
      if (a.key === "__none__") return 1;
      if (b.key === "__none__") return -1;
      return b.items.length - a.items.length || a.label.localeCompare(b.label);
    });

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
        citations: Array.isArray(summaryRow.citations)
          ? (summaryRow.citations as unknown as SummaryCitation[])
          : [],
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

  const reports = (reportsRes.data ?? []).filter(keep);
  const breaking = (breakingRes.data ?? []).filter(keep);

  // Activity-by-actor sections: per-country nation-state cards (built above),
  // and per-actor eCrime and hacktivism cards derived from breaches (and
  // hacktivism-tagged reports).
  const { ecrimeCards, hacktivismCards } = buildActorSectionCards(
    breaches,
    reports,
    ecrimeGroups,
    buildHacktivismGroups(),
  );

  return {
    compiledAt,
    executiveSummary,
    nationStateCards,
    ecrimeCards,
    hacktivismCards,
    timeline: timelineRes.data ?? [],
    ecrimeTimeline,
    vulnTimeline,
    breaking,
    reports,
    vulnerabilities,
    breaches,
    staleFeeds: (staleFeedsRes.data ?? []).map((s) => ({
      name: s.name,
      category: s.category,
      lastItemAt: s.last_item_at,
      lastError: s.last_error,
    })),
  };
}
