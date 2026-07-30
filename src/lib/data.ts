import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { buildGroupsFromAdversaries } from "@/lib/ingest/adversaries";
import { buildEcrimeActorGroups } from "@/lib/ecrime";
import { isThreatIntel } from "@/lib/relevance";
import { adversaryLabel, NEXUS_ACCENT, type Nexus } from "@/lib/badges";
import { nexusForCountry } from "@/lib/actor-classify";
import { countryFlag } from "@/lib/flags";
import {
  GROUP_TABLE,
  sortGroups,
  deriveAdversaryFromText,
} from "@/lib/ingest/enrich/rules";
import {
  buildActorSectionCards,
  buildHacktivismGroups,
  type ActorItem,
  type ActorCard,
} from "@/lib/actor-sections";
import {
  buildTimeline,
  type TimelineEvent,
  type TimelineStream,
} from "@/lib/timeline";

// A single card/item shape drives all three activity-by-actor sections.
export type { ActorItem, ActorCard };
export type { TimelineEvent, TimelineStream };

type Tables = Database["public"]["Tables"];

export type IntelItemRow = Tables["intel_items"]["Row"];
export type VulnerabilityRow = Tables["vulnerabilities"]["Row"];
export type BreachRow = Tables["breaches"]["Row"];
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

// A single breaking-ticker entry (a PoC exploit or a breach).
export type TickerItem = {
  id: string;
  kind: "exploit" | "breach";
  date: string | null;
  title: string;
  url: string | null;
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
  // Per-actor cards for each section, each with a trailing "Non Attributed" card.
  nationStateCards: ActorCard[];
  ecrimeCards: ActorCard[];
  hacktivismCards: ActorCard[];
  // One unified timeline: a stream per adversary (plus an Exploits lane).
  timeline: { events: TimelineEvent[]; streams: TimelineStream[] };
  // Breaking ticker: PoC exploits + breaches from the last ~24h. Nothing else.
  breaking: TickerItem[];
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
    // Unified timeline: all intel over the 30-day window, attributed to a stream.
    supabase
      .from("intel_items")
      .select("*")
      .gte("published_at", timelineCutoff)
      .order("published_at", { ascending: true }),
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
  const nationStateCards: ActorCard[] = [...nsByCountry.entries()]
    .map(([key, items]) => {
      const nexus: Nexus = key ? nexusForCountry(key) : "other";
      return {
        key: key || "__none__",
        label: key || "Non Attributed",
        accent: NEXUS_ACCENT[nexus] ?? "#475569",
        flag: key ? countryFlag(key) : null,
        items,
      };
    })
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

  const vulns30 = vulnsRes.data ?? [];
  const vulnerabilities = vulns30.filter(
    (v) => (v.added_at ?? "") >= recentCutoff,
  );

  const reports = (reportsRes.data ?? []).filter(keep);

  // Breaking ticker: PoC exploits and breaches observed in the last ~24h only,
  // newest first. Nothing else feeds the ticker.
  const breaking: TickerItem[] = [
    ...vulns30
      .filter((v) => v.status === "poc" && (v.added_at ?? "") >= breakingCutoff)
      .map((v) => ({
        id: `vuln-${v.id}`,
        kind: "exploit" as const,
        date: v.added_at,
        title: v.target ? `${v.cve_id} - ${v.target}` : v.cve_id,
        url: v.url,
      })),
    ...breaches30
      .filter((b) => (b.event_date ?? "") >= breakingCutoff)
      .map((b) => ({
        id: `breach-${b.id}`,
        kind: "breach" as const,
        date: b.event_date,
        title: b.org_name,
        url: b.url,
      })),
  ].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  const hacktivismGroups = buildHacktivismGroups();

  // Activity-by-actor sections: per-country nation-state cards (built above),
  // and per-actor eCrime and hacktivism cards derived from breaches (and
  // hacktivism-tagged reports).
  const { ecrimeCards, hacktivismCards } = buildActorSectionCards(
    breaches,
    reports,
    ecrimeGroups,
    hacktivismGroups,
  );

  // Unified timeline: reports + breaches + exploits over 30 days, each on an
  // adversary stream (nation-state / eCrime / hacktivism), plus an Exploits lane.
  const timelineIntel = (timelineRes.data ?? []).filter(keep);
  const timeline = buildTimeline(
    timelineIntel,
    breaches30,
    vulns30,
    ecrimeGroups,
    hacktivismGroups,
  );

  return {
    compiledAt,
    executiveSummary,
    nationStateCards,
    ecrimeCards,
    hacktivismCards,
    timeline,
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
