import type { Database } from "@/lib/supabase/database.types";
import type { GroupEntry } from "@/lib/ingest/enrich/rules";
import { sortGroups, matchGroup } from "@/lib/ingest/enrich/rules";

type BreachRow = Database["public"]["Tables"]["breaches"]["Row"];
type IntelItemRow = Database["public"]["Tables"]["intel_items"]["Row"];

/** A single report shown inside an eCrime / hacktivism actor card. */
export type ActorReport = {
  id: string;
  rawHash: string;
  title: string;
  url: string | null;
  description: string | null;
  sourceName: string | null;
  date: string | null;
};

/** One actor's card: the actor name (or "Unattributed") and its reports. */
export type ActorGroupCard = {
  name: string;
  items: ActorReport[];
};

// Known hacktivist collectives (distinctive, ASCII-only names).
export const KNOWN_HACKTIVISM_NAMES = [
  "Anonymous Sudan",
  "NoName057(16)",
  "NoName057",
  "KillNet",
  "IT Army of Ukraine",
  "SiegedSec",
  "GhostSec",
  "Cyber Av3ngers",
  "Handala",
  "Mysterious Team Bangladesh",
  "Team Insane PK",
  "RipperSec",
  "Dark Storm Team",
  "Turk Hack Team",
  "SylhetGang",
  "CyberVolk",
  "Holy League",
  "Hunt3r Kill3rs",
];

const HACKTIVISM_RE = /\bhacktivis(?:m|t|ts)\b/i;

/** Group list for hacktivist collectives, longest-first for matching. */
export function buildHacktivismGroups(): GroupEntry[] {
  return sortGroups(
    KNOWN_HACKTIVISM_NAMES.map((n) => ({
      alias: n.toLowerCase(),
      nexus: "other" as const,
      cs: n,
    })),
  );
}

function breachToReport(b: BreachRow): ActorReport {
  return {
    id: b.id,
    rawHash: b.raw_hash,
    title: b.org_name,
    url: b.url,
    description: b.summary,
    sourceName: b.source_name,
    date: b.event_date_label ?? b.event_date,
  };
}

function intelToReport(i: IntelItemRow): ActorReport {
  return {
    id: i.id,
    rawHash: i.raw_hash,
    title: i.title,
    url: i.url,
    description: i.description,
    sourceName: i.source_name,
    date: i.published_at,
  };
}

function push(map: Map<string, ActorReport[]>, key: string, item: ActorReport) {
  const arr = map.get(key);
  if (arr) arr.push(item);
  else map.set(key, [item]);
}

/** Named actors first (most reports first), "Unattributed" always last. */
function toCards(map: Map<string, ActorReport[]>): ActorGroupCard[] {
  return [...map.entries()]
    .map(([name, items]) => ({ name, items }))
    .sort((a, b) => {
      if (a.name === "Unattributed") return 1;
      if (b.name === "Unattributed") return -1;
      return b.items.length - a.items.length || a.name.localeCompare(b.name);
    });
}

/**
 * Split eCrime and hacktivism activity into per-actor cards. Breaches are eCrime
 * by nature and are attributed to a crew (or "Unattributed"); a breach or report
 * that names a hacktivist collective is routed to hacktivism instead. Reports
 * that read as hacktivism without a named group go to hacktivism "Unattributed".
 */
export function buildActorSectionCards(
  breaches: BreachRow[],
  reports: IntelItemRow[],
  ecrimeGroups: GroupEntry[],
  hacktivismGroups: GroupEntry[],
): { ecrimeCards: ActorGroupCard[]; hacktivismCards: ActorGroupCard[] } {
  const ecrime = new Map<string, ActorReport[]>();
  const hack = new Map<string, ActorReport[]>();

  for (const b of breaches) {
    const text = `${b.org_name} ${b.summary ?? ""}`.toLowerCase();
    const h = matchGroup(text, hacktivismGroups)?.cs;
    if (h) {
      push(hack, h, breachToReport(b));
    } else {
      const crew = matchGroup(text, ecrimeGroups)?.cs ?? "Unattributed";
      push(ecrime, crew, breachToReport(b));
    }
  }

  for (const r of reports) {
    const text = `${r.title} ${r.description ?? ""}`;
    const h = matchGroup(text.toLowerCase(), hacktivismGroups)?.cs;
    if (h) push(hack, h, intelToReport(r));
    else if (HACKTIVISM_RE.test(text)) push(hack, "Unattributed", intelToReport(r));
  }

  return { ecrimeCards: toCards(ecrime), hacktivismCards: toCards(hack) };
}
