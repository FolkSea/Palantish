import type { Database } from "@/lib/supabase/database.types";
import type { GroupEntry } from "@/lib/ingest/enrich/rules";
import { matchGroup, hasHacktivismKeyword } from "@/lib/ingest/enrich/rules";
import { isSpecificAdversary, NEXUS_ACCENT } from "@/lib/badges";

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
  labels: string[];
};

export type LabelsById = Map<string, string[]>;

/**
 * The three sections of Activity by actor. A card key is only unique within
 * one of them - "Non Attributed" appears in all three - so a page request has
 * to name both.
 */
export type ActorSection = "nation_state" | "ecrime" | "hacktivism";

export type ActorCard = {
  key: string;
  label: string;
  accent: string; // top-border colour
  flag: string | null; // country flag (nation-state only)
  /** The page being shown - not necessarily every report on the card. */
  items: ActorItem[];
  /** Every report on the card, which is what the header counts. */
  total: number;
};

function intelToItem(i: IntelItemRow, labels: string[]): ActorItem {
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
    labels,
  };
}

/**
 * The specific group a report names, or null. A bare animal family is a naming
 * convention rather than an actor, so it never becomes a card of its own - the
 * same rule the timeline lanes follow.
 */
function namedActor(cs: string | null, label: string | null): string | null {
  const fromCs = cs?.trim();
  if (isSpecificAdversary(fromCs)) return fromCs as string;
  const l = label?.trim();
  if (isSpecificAdversary(l)) return l as string;
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
        total: items.length,
      };
    })
    .sort((a, b) => {
      if (a.label === NON_ATTRIBUTED) return 1;
      if (b.label === NON_ATTRIBUTED) return -1;
      return b.total - a.total || a.label.localeCompare(b.label);
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
  labelsById: LabelsById = new Map(),
): { ecrimeCards: ActorCard[]; hacktivismCards: ActorCard[] } {
  const ecrime = new Map<string, ActorItem[]>();
  const hack = new Map<string, ActorItem[]>();
  const toItem = (r: IntelItemRow) => intelToItem(r, labelsById.get(r.id) ?? []);

  for (const r of reports) {
    const named = namedActor(r.crowdstrike_adversary, r.adversary_label);
    const text = `${r.title} ${r.description ?? ""}`.toLowerCase();

    if (r.motivation === "ecrime") {
      push(ecrime, named ?? matchGroup(text, ecrimeGroups)?.cs ?? NON_ATTRIBUTED, toItem(r));
    } else if (r.motivation === "hacktivism") {
      push(hack, named ?? matchGroup(text, hacktivismGroups)?.cs ?? NON_ATTRIBUTED, toItem(r));
    } else {
      // Unattributed: fall back to text matching, hacktivism first.
      const h = matchGroup(text, hacktivismGroups)?.cs;
      if (h) push(hack, h, toItem(r));
      else if (hasHacktivismKeyword(text)) push(hack, NON_ATTRIBUTED, toItem(r));
      else {
        const e = matchGroup(text, ecrimeGroups)?.cs;
        if (e) push(ecrime, e, toItem(r));
        // else: no eCrime/hacktivism signal - not shown in these sections.
      }
    }
  }

  return {
    ecrimeCards: toCards(ecrime, ECRIME_ACCENT, ECRIME_UNID),
    hacktivismCards: toCards(hack, HACKTIVISM_ACCENT, HACKTIVISM_UNID),
  };
}
