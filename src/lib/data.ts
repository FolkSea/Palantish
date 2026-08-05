import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/paging";
import { loadLabelsFor } from "@/lib/report-labels";
import { STALE_DAYS } from "@/lib/feed-status";
import type { Database } from "@/lib/supabase/database.types";
import {
  buildGroupsFromAdversaries,
  type AdversaryGroupInput,
} from "@/lib/ingest/adversaries";
import { isThreatIntel } from "@/lib/relevance";
import { adversaryLabel, NEXUS_ACCENT, type Nexus } from "@/lib/badges";
import { nexusForCountry } from "@/lib/actor-classify";
import { countryFlag } from "@/lib/flags";
import {
  sortGroups,
  deriveAdversaryFromText,
  type GroupEntry,
} from "@/lib/ingest/enrich/rules";
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

/** What the timeline needs to draw: the points, and the lanes they sit on. */
export type TimelineData = {
  events: TimelineEvent[];
  streams: TimelineStream[];
};

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
  timeline: TimelineData;
  // Breaking ticker: PoC exploits + breaches from the last ~24h. Nothing else.
  breaking: TickerItem[];
  reports: LabeledIntelRow[];
  vulnerabilities: VulnerabilityRow[];
  breaches: BreachRow[];
  staleFeeds: StaleFeed[];
};

/**
 * How far back the dashboard looks. One window for every section - the lists
 * paginate it rather than each slicing its own shorter view of the same data,
 * which is what made "the last 7 days" and "the last 30 days" mean different
 * things on one page.
 *
 * The timeline offers its own range picker over this window and fetches
 * further back on demand (see loadTimelineWindow).
 */
export const HISTORY_DAYS = 90;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Every item of one kind published since `cutoff`, newest first.
 *
 * Paged, because PostgREST caps a response at max_rows and truncates in
 * silence: at 90 days a single kind can exceed the cap, and the missing rows
 * would look exactly like a quiet week. published_at is not unique, so it is
 * not a total order on its own - id breaks the tie, without which rows swap
 * across page boundaries and some are never returned at all.
 */
function itemsSince(db: Db, kind: string, cutoff: string): Promise<IntelItemRow[]> {
  return fetchAllPages<IntelItemRow>((from, to) =>
    db
      .from("intel_items")
      .select("*")
      .eq("kind", kind)
      .gte("published_at", cutoff)
      .order("published_at", { ascending: false })
      .order("id")
      .range(from, to),
  );
}

/** The raw_hashes this user has hidden. RLS scopes the query to their rows. */
async function loadHidden(db: Db): Promise<Set<string>> {
  const rows = await fetchAllPages<{ raw_hash: string }>((from, to) =>
    db.from("hidden_items").select("raw_hash").order("raw_hash").range(from, to),
  );
  return new Set(rows.map((r) => r.raw_hash));
}

type ActorGroups = {
  nsGroups: GroupEntry[];
  ecrimeGroups: GroupEntry[];
  hacktivismGroups: GroupEntry[];
};

/**
 * The adversary catalogue, split into the three matchers the dashboard uses.
 * The single source of actor identity: nothing here is hardcoded.
 */
async function loadActorGroups(db: Db): Promise<ActorGroups> {
  const { data } = await db
    .from("adversaries")
    .select(
      "name, nexus, motivation, community_identifiers, internal_alternative_names",
    );
  const all = (data ?? []) as AdversaryGroupInput[];
  const withMotivation = (m: string) =>
    all.filter((a) => (a.motivation ?? []).includes(m));
  return {
    nsGroups: sortGroups(
      buildGroupsFromAdversaries(all.filter((a) => a.nexus !== "other")),
    ),
    ecrimeGroups: sortGroups(buildGroupsFromAdversaries(withMotivation("ecrime"))),
    hacktivismGroups: sortGroups(
      buildGroupsFromAdversaries(withMotivation("hacktivism")),
    ),
  };
}

/**
 * Loads every section of the dashboard in parallel. All queries run under the
 * caller's RLS context.
 */
export async function loadDashboard(): Promise<DashboardData> {
  const supabase = await createClient();
  const historyCutoff = daysAgo(HISTORY_DAYS);
  // Breaking ticker shows only the freshest items (last ~24h). published_at is
  // date-granular, so this is a 1-day date cutoff.
  const breakingCutoff = daysAgo(1);
  // Staleness is its own question and keeps its own window: a feed silent for a
  // month is worth flagging whether or not the dashboard shows three.
  const staleCutoff = new Date(
    Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [
    researchRows,
    breachRows,
    exploitRows,
    otherRows,
    groups,
    hidden,
    summaryRes,
    staleFeedsRes,
    refreshRes,
  ] = await Promise.all([
    itemsSince(supabase, "research", historyCutoff),
    itemsSince(supabase, "breach", historyCutoff),
    itemsSince(supabase, "exploit", historyCutoff),
    itemsSince(supabase, "other", historyCutoff),
    loadActorGroups(supabase),
    loadHidden(supabase),
    supabase
      .from("executive_summaries")
      .select("summary, source, model, generated_at, citations")
      .order("generated_at", { ascending: false })
      .limit(1),
    // Active feeds whose newest item is older than the stale window.
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

  // Keep only genuine threat-intel posts across the dashboard (drop marketing,
  // corporate/business news, event promos, podcasts, and lifestyle content),
  // and drop anything this user has hidden.
  const keep = (i: { title: string | null; description?: string | null; raw_hash: string }) =>
    isThreatIntel(i.title, i.description) && !hidden.has(i.raw_hash);
  const labelsById: LabelsById = await loadLabelsFor(supabase, [
    ...new Set(
      [...researchRows, ...breachRows, ...otherRows].map((r) => r.id),
    ),
  ]);

  // Every country-attributed item gets a label: the stored adversary_label if
  // present (so operator edits stick), otherwise a computed fallback - the
  // specific name, or "UNID <animal>" keyed by the actor's nexus (country-
  // specific for Rest of the World).
  const { nsGroups, ecrimeGroups, hacktivismGroups } = groups;
  // Research items feed the actor sections + timeline over the whole window;
  // the section components paginate each card to 5 items.
  const researchItems = researchRows.filter(keep);
  // Nation-state activity grouped into one card per country, plus a
  // "Non Attributed" card for nation-state items without a country.
  const nsByCountry = new Map<string, ActorItem[]>();
  for (const i of researchItems) {
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
          i.country,
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

  const withLabels = (r: IntelItemRow): LabeledIntelRow => ({
    ...r,
    labels: labelsById.get(r.id) ?? [],
  });
  // Each list is the whole window; the section components paginate it.
  const breachItems = breachRows.filter(keep);
  const breaches = breachItems.map(withLabels);

  const exploitItems = exploitRows.filter((v) => !hidden.has(v.raw_hash));
  const vulnerabilities = exploitItems;

  const reports = otherRows.filter(keep).map(withLabels);

  // Breaking ticker: PoC exploits and breaches observed in the last ~24h only,
  // newest first. Nothing else feeds the ticker.
  const breaking: TickerItem[] = [
    ...exploitItems
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
    ...breachItems
      .filter((b) => (b.published_at ?? "") >= breakingCutoff)
      .map((b) => ({
        id: `breach-${b.id}`,
        kind: "breach" as const,
        date: b.published_at,
        title: b.title,
        url: b.url,
      })),
  ].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  // Activity-by-actor sections: per-country nation-state cards (built above),
  // and per-actor eCrime and hacktivism cards. All three carry research
  // (intelligence) reports only; breach/leak posts stay in the Breaches list.
  const { ecrimeCards, hacktivismCards } = buildActorSectionCards(
    researchItems,
    ecrimeGroups,
    hacktivismGroups,
    labelsById,
  );

  // Unified timeline: research + breaches + exploits over the window, branched
  // by kind onto adversary / Breaches / Exploits lanes.
  const timeline = buildTimeline(
    [...researchItems, ...breachItems, ...exploitItems],
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

/**
 * The timeline over an arbitrary window, for the range picker.
 *
 * The dashboard already ships HISTORY_DAYS of events, so this only runs when
 * the reader asks for more than that - it loads the same three kinds through
 * the same builder, so a year looks like the default view, only longer.
 */
export async function loadTimelineWindow(days: number): Promise<TimelineData> {
  const supabase = await createClient();
  const cutoff = daysAgo(days);
  const [researchRows, breachRows, exploitRows, groups, hidden] =
    await Promise.all([
      itemsSince(supabase, "research", cutoff),
      itemsSince(supabase, "breach", cutoff),
      itemsSince(supabase, "exploit", cutoff),
      loadActorGroups(supabase),
      loadHidden(supabase),
    ]);
  const keep = (i: {
    title: string | null;
    description?: string | null;
    raw_hash: string;
  }) => isThreatIntel(i.title, i.description) && !hidden.has(i.raw_hash);
  return buildTimeline(
    [
      ...researchRows.filter(keep),
      ...breachRows.filter(keep),
      ...exploitRows.filter((v) => !hidden.has(v.raw_hash)),
    ],
    groups.ecrimeGroups,
    groups.hacktivismGroups,
  );
}

/**
 * When the dashboard was last compiled: the newest successful ingest run. Its
 * own loader because the site header shows it on every page, and pulling the
 * whole dashboard for one timestamp would be absurd.
 */
export async function loadCompiledAt(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("refresh_runs")
    .select("finished_at, started_at")
    .eq("status", "success")
    .order("started_at", { ascending: false })
    .limit(1);
  const latest = data?.[0];
  return latest?.finished_at ?? latest?.started_at ?? null;
}
