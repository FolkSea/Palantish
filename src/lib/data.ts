import { createClient } from "@/lib/supabase/server";
import {
  pageOf,
  CARD_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  type Page,
} from "@/lib/page";
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
import { prioritiseVulns, type PrioritisedVuln } from "@/lib/vuln-priority";
import {
  buildActorSectionCards,
  type ActorItem,
  type ActorCard,
  type LabelsById,
  type ActorSection,
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

export type { Page, ActorSection };

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
  reports: Page<LabeledIntelRow>;
  vulnerabilities: Page<PrioritisedVuln>;
  breaches: Page<BreachRow>;
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
 * Nation-state activity as one card per country, plus a "Non Attributed" card
 * for items with no country. Most-active country first, and Non Attributed
 * always last.
 *
 * Every item gets an adversary label: the stored one if present (so operator
 * edits stick), otherwise a computed fallback - the specific name, or
 * "UNID <animal>" keyed by the actor's nexus.
 */
function nationStateCardsFrom(
  reports: IntelItemRow[],
  nsGroups: GroupEntry[],
  labelsById: LabelsById,
): ActorCard[] {
  const byCountry = new Map<string, ActorItem[]>();
  for (const i of reports) {
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
    const arr = byCountry.get(key);
    if (arr) arr.push(item);
    else byCountry.set(key, [item]);
  }
  return [...byCountry.entries()]
    .map(([key, items]) => {
      const nexus: Nexus = key ? nexusForCountry(key) : "other";
      return {
        key: key || "__none__",
        label: key || "Non Attributed",
        accent: NEXUS_ACCENT[nexus] ?? "#475569",
        flag: key ? countryFlag(key) : null,
        items,
        total: items.length,
      };
    })
    .sort((a, b) => {
      if (a.key === "__none__") return 1;
      if (b.key === "__none__") return -1;
      return b.total - a.total || a.label.localeCompare(b.label);
    });
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

  const { nsGroups, ecrimeGroups, hacktivismGroups } = groups;
  // Research items feed the actor sections and the timeline over the whole
  // window; the cards show a page of each.
  const researchItems = researchRows.filter(keep);
  const nationStateCards = nationStateCardsFrom(
    researchItems,
    nsGroups,
    labelsById,
  );

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
  // The lists are paged on this side: the reader gets one page and a count,
  // and asks for the next one. Everything below still works from the whole
  // window, because the ticker, the cards and the timeline each need all of it.
  const breachItems = breachRows.filter(keep);
  const breaches = pageOf(breachItems.map(withLabels), 0, DEFAULT_PAGE_SIZE);

  const exploitItems = exploitRows.filter((v) => !hidden.has(v.raw_hash));
  const vulnerabilities = pageOf(
    prioritiseVulns(exploitItems),
    0,
    DEFAULT_PAGE_SIZE,
  );

  const reports = pageOf(
    otherRows.filter(keep).map(withLabels),
    0,
    DEFAULT_PAGE_SIZE,
  );

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
    // Cards keep their totals but carry only the page on show; a card the
    // reader pages through asks for the rest.
    nationStateCards: firstPageOfCards(nationStateCards),
    ecrimeCards: firstPageOfCards(ecrimeCards),
    hacktivismCards: firstPageOfCards(hacktivismCards),
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

/** Trim every card to its first page, leaving `total` to say what is behind it. */
function firstPageOfCards(cards: ActorCard[]): ActorCard[] {
  return cards.map((c) => ({ ...c, items: c.items.slice(0, CARD_PAGE_SIZE) }));
}

/**
 * One page of a dashboard list.
 *
 * Each of these re-reads its own window rather than the whole dashboard: a
 * reader clicking Next should not pay for the timeline and the actor cards
 * again. The filtering (marketing, hidden items, CVE aggregation) happens in
 * memory rather than in SQL, so the page cannot be taken with LIMIT/OFFSET -
 * but the rows stay on this side, which is the point.
 */
export async function loadReportsPage(
  page: number,
  size: number | null,
): Promise<Page<LabeledIntelRow>> {
  const db = await createClient();
  const [rows, hidden] = await Promise.all([
    itemsSince(db, "other", daysAgo(HISTORY_DAYS)),
    loadHidden(db),
  ]);
  const kept = rows.filter(
    (r) => isThreatIntel(r.title, r.description) && !hidden.has(r.raw_hash),
  );
  const labels = await loadLabelsFor(db, kept.map((r) => r.id));
  return pageOf(
    kept.map((r) => ({ ...r, labels: labels.get(r.id) ?? [] })),
    page,
    size,
  );
}

export async function loadBreachesPage(
  page: number,
  size: number | null,
): Promise<Page<BreachRow>> {
  const db = await createClient();
  const [rows, hidden] = await Promise.all([
    itemsSince(db, "breach", daysAgo(HISTORY_DAYS)),
    loadHidden(db),
  ]);
  const kept = rows.filter(
    (r) => isThreatIntel(r.title, r.description) && !hidden.has(r.raw_hash),
  );
  const labels = await loadLabelsFor(db, kept.map((r) => r.id));
  return pageOf(
    kept.map((r) => ({ ...r, labels: labels.get(r.id) ?? [] })),
    page,
    size,
  );
}

export async function loadVulnerabilitiesPage(
  page: number,
  size: number | null,
): Promise<Page<PrioritisedVuln>> {
  const db = await createClient();
  const [rows, hidden] = await Promise.all([
    itemsSince(db, "exploit", daysAgo(HISTORY_DAYS)),
    loadHidden(db),
  ]);
  // Aggregated to one row per CVE before paging, so a page is ten CVEs and
  // not ten reports about three of them.
  return pageOf(
    prioritiseVulns(rows.filter((v) => !hidden.has(v.raw_hash))),
    page,
    size,
  );
}

export async function loadActorCardPage(
  section: ActorSection,
  key: string,
  page: number,
  size: number | null,
): Promise<Page<ActorItem>> {
  const db = await createClient();
  const [rows, groups, hidden] = await Promise.all([
    itemsSince(db, "research", daysAgo(HISTORY_DAYS)),
    loadActorGroups(db),
    loadHidden(db),
  ]);
  const kept = rows.filter(
    (r) => isThreatIntel(r.title, r.description) && !hidden.has(r.raw_hash),
  );
  const labels = await loadLabelsFor(db, kept.map((r) => r.id));
  const cards =
    section === "nation_state"
      ? nationStateCardsFrom(kept, groups.nsGroups, labels)
      : buildActorSectionCards(
          kept,
          groups.ecrimeGroups,
          groups.hacktivismGroups,
          labels,
        )[section === "ecrime" ? "ecrimeCards" : "hacktivismCards"];
  const card = cards.find((c) => c.key === key);
  return pageOf(card?.items ?? [], page, size);
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
