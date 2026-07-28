import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type Db = SupabaseClient<Database>;

export type WindowCounts = {
  nationState: number;
  ecrime: number;
  vulns: number;
  byActor: Record<string, number>;
};

export type NotableItem = {
  title: string;
  actor: string;
  type: string;
  date: string;
  cs: string | null;
};

export type Aggregates = {
  last24h: WindowCounts;
  last7d: WindowCounts;
  vuln7d: { confirmed: number; poc: number; suspected: number };
  notable: NotableItem[];
};

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

const NEXUS_LABEL: Record<string, string> = {
  china: "China",
  russia: "Russia",
  north_korea: "North Korea",
  iran: "Iran",
  rest_of_world: "Rest of World",
  other: "eCrime/Other",
};

/** Compute the 24h / 7d activity aggregates used by the executive summary. */
export async function computeAggregates(db: Db): Promise<Aggregates> {
  const cut7 = isoDaysAgo(7);
  const cut1 = isoDaysAgo(1);

  const [{ data: actors }, { data: intel }, { data: vulns }, { data: breaches }] =
    await Promise.all([
      db.from("actors").select("id, nexus, display_name"),
      db
        .from("intel_items")
        .select("title, item_type, actor_id, crowdstrike_adversary, published_at")
        .gte("published_at", cut7)
        .order("published_at", { ascending: false }),
      db.from("vulnerabilities").select("status, added_at").gte("added_at", cut7),
      db.from("breaches").select("event_date").gte("event_date", cut7),
    ]);

  const nexusById = new Map(
    (actors ?? []).map((a) => [a.id, a.nexus as string]),
  );

  const emptyWindow = (): WindowCounts => ({
    nationState: 0,
    ecrime: 0,
    vulns: 0,
    byActor: {},
  });
  const w24 = emptyWindow();
  const w7 = emptyWindow();

  for (const i of intel ?? []) {
    const nexus = i.actor_id ? nexusById.get(i.actor_id) : undefined;
    const label = nexus ? (NEXUS_LABEL[nexus] ?? "Other") : "Unattributed";
    const isNation =
      nexus === "china" ||
      nexus === "russia" ||
      nexus === "north_korea" ||
      nexus === "iran" ||
      nexus === "rest_of_world";

    for (const [w, cut] of [
      [w7, cut7],
      [w24, cut1],
    ] as const) {
      if ((i.published_at ?? "") < cut) continue;
      if (isNation) w.nationState++;
      w.byActor[label] = (w.byActor[label] ?? 0) + 1;
    }
  }

  for (const v of vulns ?? []) {
    w7.vulns++;
    if ((v.added_at ?? "") >= cut1) w24.vulns++;
  }
  for (const b of breaches ?? []) {
    w7.ecrime++;
    if ((b.event_date ?? "") >= cut1) w24.ecrime++;
  }

  const vuln7d = { confirmed: 0, poc: 0, suspected: 0 };
  for (const v of vulns ?? []) {
    if (v.status in vuln7d) vuln7d[v.status as keyof typeof vuln7d]++;
  }

  const notable: NotableItem[] = (intel ?? []).slice(0, 12).map((i) => {
    const nexus = i.actor_id ? nexusById.get(i.actor_id) : undefined;
    return {
      title: i.title,
      actor: nexus ? (NEXUS_LABEL[nexus] ?? "Other") : "Unattributed",
      type: i.item_type,
      date: i.published_at ?? "",
      cs: i.crowdstrike_adversary,
    };
  });

  return { last24h: w24, last7d: w7, vuln7d, notable };
}
