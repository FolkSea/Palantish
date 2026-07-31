import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import {
  buildGroupsFromAdversaries,
  type AdversaryGroupInput,
} from "@/lib/ingest/adversaries";
import { isThreatIntel } from "@/lib/relevance";
import { adversaryLabel, NEXUS_ACCENT, type Nexus } from "@/lib/badges";
import { nexusForCountry } from "@/lib/actor-classify";
import { countryFlag } from "@/lib/flags";
import { sortGroups, deriveAdversaryFromText } from "@/lib/ingest/enrich/rules";
import {
  buildActorSectionCards,
  type ActorItem,
  type ActorCard,
  type LabelsById,
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
// Every report is an intel_items row now, discriminated by `kind`; these aliases
// keep the section component prop names meaningful. Rows shown in the breach /
// other-reporting lists carry their user-defined labels for display.
export type VulnerabilityRow = IntelItemRow;
export type LabeledIntelRow = IntelItemRow & { labels: string[] };
export type BreachRow = LabeledIntelRow;
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
  reports: LabeledIntelRow[];
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

/** Load the user-defined labels for a set of intel_items ids, grouped by id and
 * sorted alphabetically. RLS-scoped like every other dashboard query. */
async function loadLabelsById(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
): Promise<LabelsById> {
  const map: LabelsById = new Map();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return map;
  // Small batches: many UUIDs in a GET .in() filter would overflow the URI.
  for (let i = 0; i < unique.length; i += 100) {
    const { data } = await supabase
      .from("intel_item_labels")
      .select("intel_item_id, labels(name)")
      .in("intel_item_id", unique.slice(i, i + 100));
    for (const row of data ?? []) {
      const name = (row.labels as { name: string } | null)?.name;
      if (!name) continue;
      const arr = map.get(row.intel_item_id);
      if (arr) arr.push(name);
      else map.set(row.intel_item_id, [name]);
    }
  }
  for (const [id, names] of map)
    map.set(id, names.sort((a, b) => a.localeCompare(b)));
  return map;
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
    researchRes,
    breachRes,
    exploitRes,
    otherRes,
    advRes,
    summaryRes,
    staleFeedsRes,
    refreshRes,
  ] = await Promise.all([
    // Research feeds the actor cards + timeline; 30d (sections slice to 7d).
    supabase
      .from("intel_items")
      .select("*")
      .eq("kind", "research")
      .gte("published_at", timelineCutoff)
      .order("published_at", { ascending: false }),
    supabase
      .from("intel_items")
      .select("*")
      .eq("kind", "breach")
      .gte("published_at", timelineCutoff)
      .order("published_at", { ascending: false }),
    supabase
      .from("intel_items")
      .select("*")
      .eq("kind", "exploit")
      .gte("published_at", timelineCutoff)
      .order("published_at", { ascending: false }),
    // Other reporting is a 7-day list only (not on the timeline).
    supabase
      .from("intel_items")
      .select("*")
      .eq("kind", "other")
      .gte("published_at", recentCutoff)
      .order("published_at", { ascending: false }),
    // The whole adversary catalogue - the single source of actor identity. Split
    // by nexus/motivation below into nation-state, eCrime and hacktivism matchers.
    supabase
      .from("adversaries")
      .select(
        "name, nexus, motivation, community_identifiers, internal_alternative_names",
      ),
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
  // Labels for every report shown on the page (actor cards, breaches, other
  // reporting), fetched once and looked up by intel_items id.
  const labelsById = await loadLabelsById(supabase, [
    ...(researchRes.data ?? []).map((r) => r.id),
    ...(breachRes.data ?? []).map((r) => r.id),
    ...(otherRes.data ?? []).map((r) => r.id),
  ]);

  // Split the adversary catalogue into the three matchers the dashboard needs.
  // "other" nexus is eCrime or hacktivism, told apart by the actor's motivation;
  // everything else is nation-state / rest-of-world.
  const allAdv = (advRes.data ?? []) as AdversaryGroupInput[];
  const hasMotivation = (a: AdversaryGroupInput, m: string) =>
    (a.motivation ?? []).includes(m);
  // Every country-attributed item gets a label: the stored adversary_label if
  // present (so operator edits stick), otherwise a computed fallback - the
  // specific name, or "UNID <animal>" keyed by the actor's nexus (country-
  // specific for Rest of the World).
  const nsGroups = sortGroups(
    buildGroupsFromAdversaries(allAdv.filter((a) => a.nexus !== "other")),
  );
  // Research items feed the actor sections + timeline. Cards show the last 30d
  // (the section components paginate each card to 5 items).
  const research30 = (researchRes.data ?? []).filter(keep);
  // Nation-state activity grouped into one card per country, plus a
  // "Non Attributed" card for nation-state items without a country.
  const nsByCountry = new Map<string, ActorItem[]>();
  for (const i of research30) {
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
      labels: labelsById.get(i.id) ?? [],
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

  // eCrime attribution matcher: catalogue actors whose motivation is eCrime.
  const ecrimeGroups = sortGroups(
    buildGroupsFromAdversaries(allAdv.filter((a) => hasMotivation(a, "ecrime"))),
  );

  const withLabels = (r: IntelItemRow): LabeledIntelRow => ({
    ...r,
    labels: labelsById.get(r.id) ?? [],
  });
  const breach30 = (breachRes.data ?? []).filter(keep);
  const breaches = breach30
    .filter((b) => (b.published_at ?? "") >= recentCutoff)
    .map(withLabels);

  const exploit30 = (exploitRes.data ?? []).filter((v) => !hidden.has(v.raw_hash));
  const vulnerabilities = exploit30.filter(
    (v) => (v.published_at ?? "") >= recentCutoff,
  );

  // Other reporting: 7-day list of unattributed general reporting.
  const reports = (otherRes.data ?? []).filter(keep).map(withLabels);

  // Breaking ticker: PoC exploits and breaches observed in the last ~24h only,
  // newest first. Nothing else feeds the ticker.
  const breaking: TickerItem[] = [
    ...exploit30
      .filter(
        (v) =>
          v.exploit_status === "poc" &&
          (v.published_at ?? "") >= breakingCutoff,
      )
      .map((v) => ({
        id: `exploit-${v.id}`,
        kind: "exploit" as const,
        date: v.published_at,
        title: v.target ? `${v.cve_id} - ${v.target}` : v.cve_id ?? v.title,
        url: v.url,
      })),
    ...breach30
      .filter((b) => (b.published_at ?? "") >= breakingCutoff)
      .map((b) => ({
        id: `breach-${b.id}`,
        kind: "breach" as const,
        date: b.published_at,
        title: b.title,
        url: b.url,
      })),
  ].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  // Hacktivism matcher: catalogue actors whose motivation is hacktivism.
  const hacktivismGroups = sortGroups(
    buildGroupsFromAdversaries(
      allAdv.filter((a) => hasMotivation(a, "hacktivism")),
    ),
  );

  // Activity-by-actor sections: per-country nation-state cards (built above),
  // and per-actor eCrime and hacktivism cards. All three carry research
  // (intelligence) reports only; breach/leak posts stay in the Breaches list.
  const { ecrimeCards, hacktivismCards } = buildActorSectionCards(
    research30,
    ecrimeGroups,
    hacktivismGroups,
    labelsById,
  );

  // Unified timeline: research + breaches + exploits over 30 days, branched by
  // kind onto adversary / Breaches / Exploits lanes.
  const timeline = buildTimeline(
    [...research30, ...breach30, ...exploit30],
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
