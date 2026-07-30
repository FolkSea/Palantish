import type { Database } from "@/lib/supabase/database.types";
import type { GroupEntry } from "@/lib/ingest/enrich/rules";
import { matchGroup, hasHacktivismKeyword } from "@/lib/ingest/enrich/rules";

type IntelItemRow = Database["public"]["Tables"]["intel_items"]["Row"];
type BreachRow = Database["public"]["Tables"]["breaches"]["Row"];
type VulnRow = Database["public"]["Tables"]["vulnerabilities"]["Row"];

/** Marker type -> icon (chart point shape). */
export type TimelineKind = "report" | "breach" | "exploit";

/** Stream grouping / filter bucket. */
export type TimelineCategory =
  | "nation_state"
  | "ecrime"
  | "hacktivism"
  | "exploit";

/** One dot on the unified timeline: a report, breach or exploit. */
export type TimelineEvent = {
  id: string;
  date: string; // ISO (yyyy-mm-dd or full)
  actor: string; // stream label
  category: TimelineCategory;
  kind: TimelineKind;
  title: string;
  description: string | null;
  source: string | null;
  url: string | null;
};

/** One swimlane: an actor (or "Exploits"), its category and colour. */
export type TimelineStream = {
  actor: string;
  category: TimelineCategory;
  color: string;
};

/** The five filter toggles; every event is gated by category and/or kind. */
export type TimelineFilters = {
  nation_state: boolean;
  ecrime: boolean;
  hacktivism: boolean;
  breaches: boolean;
  exploits: boolean;
};

export const DEFAULT_FILTERS: TimelineFilters = {
  nation_state: true,
  ecrime: true,
  hacktivism: true,
  breaches: true,
  exploits: true,
};

// Unattributed streams, one per motivation.
export const UNID_NATION = "UNID BAT";
export const UNID_ECRIME = "UNID SPIDER";
export const UNID_HACKTIVISM = "UNID JACKAL";

const EXPLOITS_STREAM = "Exploits";

// Reserved colours: red = PoC exploits, amber = breaches, grey = any
// unattributed lane. Kept out of the actor palette so their meaning is unique.
export const POC_COLOR = "#dc2626"; // red
export const BREACH_COLOR = "#d97706"; // amber
export const UNID_COLOR = "#94a3b8"; // grey

// Distinct hues for named actors (cycled). Reds, ambers and greys are excluded
// so they stay reserved for PoCs, breaches and unattributed lanes.
const PALETTE = [
  "#2563eb", // blue
  "#059669", // emerald
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#db2777", // pink
  "#65a30d", // lime
  "#0d9488", // teal
  "#4f46e5", // indigo
  "#15803d", // green
  "#6d28d9", // purple
  "#0369a1", // sky
  "#c026d3", // fuchsia
];

const CATEGORY_ORDER: TimelineCategory[] = [
  "nation_state",
  "ecrime",
  "hacktivism",
  "exploit",
];

export const CATEGORY_LABEL: Record<TimelineCategory, string> = {
  nation_state: "Nation State",
  ecrime: "eCrime",
  hacktivism: "Hacktivism",
  exploit: "Exploits",
};

export const KIND_LABEL: Record<TimelineKind, string> = {
  report: "Report",
  breach: "Breach",
  exploit: "Exploit",
};

/** A real actor name (CS cryptonym or a stored non-UNID label), or null. */
function namedActor(cs: string | null, label: string | null): string | null {
  const fromCs = cs?.trim();
  if (fromCs) return fromCs;
  const l = label?.trim();
  if (l && !/^unid\b/i.test(l)) return l;
  return null;
}

function intelEvent(
  i: IntelItemRow,
  category: TimelineCategory,
  actor: string,
): TimelineEvent {
  return {
    id: i.id,
    date: i.published_at as string,
    actor,
    category,
    kind: "report",
    title: i.title,
    description: i.description,
    source: i.source_name,
    url: i.url,
  };
}

function breachEvent(
  b: BreachRow,
  category: TimelineCategory,
  actor: string,
): TimelineEvent {
  return {
    id: b.id,
    date: b.event_date as string,
    actor,
    category,
    kind: "breach",
    title: b.org_name,
    description: b.summary,
    source: b.source_name,
    url: b.url,
  };
}

/**
 * Assemble the unified timeline: one event per report / breach / exploit,
 * each attributed to an actor stream. Routing mirrors the actor cards -
 * motivation first, then text matching for unattributed reports - and collapses
 * anything unattributed onto the per-motivation UNID lane (BAT / SPIDER /
 * JACKAL). Exploits share a single "Exploits" lane.
 */
export function buildTimeline(
  intel: IntelItemRow[],
  breaches: BreachRow[],
  vulns: VulnRow[],
  ecrimeGroups: GroupEntry[],
  hacktivismGroups: GroupEntry[],
): { events: TimelineEvent[]; streams: TimelineStream[] } {
  const events: TimelineEvent[] = [];

  for (const i of intel) {
    if (!i.published_at) continue;
    const named = namedActor(i.crowdstrike_adversary, i.adversary_label);
    if (i.motivation === "nation_state") {
      events.push(intelEvent(i, "nation_state", named ?? UNID_NATION));
    } else if (i.motivation === "ecrime") {
      events.push(intelEvent(i, "ecrime", named ?? UNID_ECRIME));
    } else if (i.motivation === "hacktivism") {
      events.push(intelEvent(i, "hacktivism", named ?? UNID_HACKTIVISM));
    } else {
      // Unattributed motivation: route by text like buildActorSectionCards.
      const text = `${i.title} ${i.description ?? ""}`;
      const h = matchGroup(text.toLowerCase(), hacktivismGroups)?.cs;
      if (h) events.push(intelEvent(i, "hacktivism", h));
      else if (hasHacktivismKeyword(text))
        events.push(intelEvent(i, "hacktivism", UNID_HACKTIVISM));
      else {
        const e = matchGroup(text.toLowerCase(), ecrimeGroups)?.cs;
        if (e) events.push(intelEvent(i, "ecrime", e));
        // Otherwise unclassifiable - dropped, as on the cards.
      }
    }
  }

  for (const b of breaches) {
    if (!b.event_date) continue;
    const stored = namedActor(b.crowdstrike_adversary, b.adversary_label);
    const text = `${b.org_name} ${b.summary ?? ""}`.toLowerCase();
    const h = matchGroup(text, hacktivismGroups)?.cs;
    if (h) {
      events.push(breachEvent(b, "hacktivism", stored ?? h));
    } else {
      const crew = stored ?? matchGroup(text, ecrimeGroups)?.cs ?? UNID_ECRIME;
      events.push(breachEvent(b, "ecrime", crew));
    }
  }

  for (const v of vulns) {
    if (!v.added_at) continue;
    // Timeline shows only exploits with a public proof-of-concept.
    if (v.status !== "poc") continue;
    events.push({
      id: v.id,
      date: v.added_at,
      actor: EXPLOITS_STREAM,
      category: "exploit",
      kind: "exploit",
      title: v.cve_id,
      description: v.target ? `Target: ${v.target}` : v.detail,
      source: null,
      url: v.url,
    });
  }

  return { events, streams: buildStreams(events) };
}

function isUnid(actor: string): boolean {
  return /^unid\b/i.test(actor);
}

/**
 * Order lanes by category (nation-state, eCrime, hacktivism, exploits), then
 * named actors by event count, with the UNID lane last within its category.
 * Named actors get a palette hue; UNID / exploit lanes get fixed muted colours.
 */
function buildStreams(events: TimelineEvent[]): TimelineStream[] {
  const seen = new Map<string, { category: TimelineCategory; count: number }>();
  for (const e of events) {
    const cur = seen.get(e.actor);
    if (cur) cur.count += 1;
    else seen.set(e.actor, { category: e.category, count: 1 });
  }

  const actors = [...seen.entries()].map(([actor, v]) => ({ actor, ...v }));
  actors.sort((a, b) => {
    const c =
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    if (c) return c;
    const au = isUnid(a.actor) ? 1 : 0;
    const bu = isUnid(b.actor) ? 1 : 0;
    if (au !== bu) return au - bu;
    return b.count - a.count || a.actor.localeCompare(b.actor);
  });

  let hue = 0;
  return actors.map(({ actor, category }) => {
    let color: string;
    if (category === "exploit") color = POC_COLOR;
    else if (isUnid(actor)) color = UNID_COLOR;
    else color = PALETTE[hue++ % PALETTE.length];
    return { actor, category, color };
  });
}

/** Whether an event passes the current filter toggles. */
export function eventVisible(e: TimelineEvent, f: TimelineFilters): boolean {
  if (e.category === "exploit") return f.exploits;
  if (e.category === "nation_state" && !f.nation_state) return false;
  if (e.category === "ecrime" && !f.ecrime) return false;
  if (e.category === "hacktivism" && !f.hacktivism) return false;
  if (e.kind === "breach" && !f.breaches) return false;
  return true;
}
