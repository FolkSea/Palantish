import type { Database } from "@/lib/supabase/database.types";
import type { GroupEntry } from "@/lib/ingest/enrich/rules";
import {
  matchGroup,
  buildHacktivismGroups,
  hasHacktivismKeyword,
} from "@/lib/ingest/enrich/rules";
import { NEXUS_ACCENT } from "@/lib/badges";

// Re-exported so existing importers (lib/data) keep a single import site.
export { buildHacktivismGroups };

type IntelItemRow = Database["public"]["Tables"]["intel_items"]["Row"];

const ECRIME_ACCENT = NEXUS_ACCENT.other; // slate
const HACKTIVISM_ACCENT = "#7e22ce"; // purple
const NON_ATTRIBUTED = "Non Attributed";
const ECRIME_UNID = "UNID SPIDER"; // fallback label for unattributed eCrime
const HACKTIVISM_UNID = "UNID JACKAL"; // fallback label for unattributed hacktivism

/**
 * One report inside an actor card. The same shape is used for nation-state,
 * eCrime and hacktivism items so all three sections render through a single
 * card component.
 */
export type ActorItem = {
  id: string;
  raw_hash: string;
  title: string;
  url: string | null;
  description: string | null;
  source_name: string | null;
  published_at: string | null;
  confidence: string | null;
  country: string | null;
  adversary: string | null;
};

/** One actor's card: the actor (or "Non Attributed"), accent/flag and items. */
export type ActorCard = {
  key: string;
  label: string;
  accent: string; // top-border colour
  flag: string | null; // country flag (nation-state only)
  items: ActorItem[];
};

function intelToItem(i: IntelItemRow): ActorItem {
  return {
    id: i.id,
    raw_hash: i.raw_hash,
    title: i.title,
    url: i.url,
    description: i.description,
    source_name: i.source_name,
    published_at: i.published_at,
    confidence: i.confidence,
    country: null,
    adversary: null,
  };
}

/** A real actor name (CS cryptonym or a stored non-UNID label), else null. */
function namedActor(cs: string | null, label: string | null): string | null {
  const fromCs = cs?.trim();
  if (fromCs) return fromCs;
  const l = label?.trim();
  if (l && !/^unid\b/i.test(l)) return l;
  return null;
}

function push(map: Map<string, ActorItem[]>, key: string, item: ActorItem) {
  const arr = map.get(key);
  if (arr) arr.push(item);
  else map.set(key, [item]);
}

/**
 * Turn the crew -> items map into cards. Every item in a card is labelled with
 * the card's actor (the crew name, or a section UNID fallback for the
 * "Non Attributed" card). Named actors first (most reports first), and the
 * "Non Attributed" card always sorts last - exactly like the nation-state cards.
 */
function toCards(
  map: Map<string, ActorItem[]>,
  accent: string,
  unidFallback: string | null,
): ActorCard[] {
  return [...map.entries()]
    .map(([label, items]) => {
      const adversary = label === NON_ATTRIBUTED ? unidFallback : label;
      return {
        key: label,
        label,
        accent,
        flag: null,
        items: items.map((it) => ({ ...it, adversary })),
      };
    })
    .sort((a, b) => {
      if (a.label === NON_ATTRIBUTED) return 1;
      if (b.label === NON_ATTRIBUTED) return -1;
      return b.items.length - a.items.length || a.label.localeCompare(b.label);
    });
}

/**
 * Split eCrime and hacktivism activity into per-actor cards (plus a
 * "Non Attributed" card each), mirroring the nation-state layout. These sections
 * carry intelligence *reports* only - breach/leak posts live in the dedicated
 * Breaches list, not here. A report is routed by its stored motivation first,
 * then by matching a named eCrime crew or hacktivist collective in its text;
 * anything with no eCrime/hacktivism signal is not shown in these sections.
 */
export function buildActorSectionCards(
  reports: IntelItemRow[],
  ecrimeGroups: GroupEntry[],
  hacktivismGroups: GroupEntry[],
): { ecrimeCards: ActorCard[]; hacktivismCards: ActorCard[] } {
  const ecrime = new Map<string, ActorItem[]>();
  const hack = new Map<string, ActorItem[]>();

  for (const r of reports) {
    const named = namedActor(r.crowdstrike_adversary, r.adversary_label);
    const text = `${r.title} ${r.description ?? ""}`.toLowerCase();

    if (r.motivation === "ecrime") {
      push(ecrime, named ?? matchGroup(text, ecrimeGroups)?.cs ?? NON_ATTRIBUTED, intelToItem(r));
    } else if (r.motivation === "hacktivism") {
      push(hack, named ?? matchGroup(text, hacktivismGroups)?.cs ?? NON_ATTRIBUTED, intelToItem(r));
    } else {
      // Unattributed: fall back to text matching, hacktivism first.
      const h = matchGroup(text, hacktivismGroups)?.cs;
      if (h) push(hack, h, intelToItem(r));
      else if (hasHacktivismKeyword(text)) push(hack, NON_ATTRIBUTED, intelToItem(r));
      else {
        const e = matchGroup(text, ecrimeGroups)?.cs;
        if (e) push(ecrime, e, intelToItem(r));
        // else: no eCrime/hacktivism signal - not shown in these sections.
      }
    }
  }

  return {
    ecrimeCards: toCards(ecrime, ECRIME_ACCENT, ECRIME_UNID),
    hacktivismCards: toCards(hack, HACKTIVISM_ACCENT, HACKTIVISM_UNID),
  };
}
