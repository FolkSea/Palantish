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

/** A report / vuln / breach the summary may reference, with the fields the
 * report modal needs. `id` is the citation number used in the prose. */
export type LinkableItem = {
  id: number;
  kind: "report" | "vuln" | "breach";
  title: string;
  url: string | null;
  description: string | null;
  sourceName: string | null;
  date: string | null;
  rawHash: string | null;
};

export type Aggregates = {
  last24h: WindowCounts;
  last7d: WindowCounts;
  vuln7d: { confirmed: number; poc: number; suspected: number };
  notable: NotableItem[];
  linkables: LinkableItem[];
};

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}


/** Compute the 24h / 7d activity aggregates used by the executive summary. */
export async function computeAggregates(db: Db): Promise<Aggregates> {
  const cut7 = isoDaysAgo(7);
  const cut1 = isoDaysAgo(1);

  // Every report lives in intel_items now; partition by kind.
  const { data: allRows } = await db
    .from("intel_items")
    .select(
      "kind, title, item_type, motivation, country, crowdstrike_adversary, published_at, url, description, source_name, raw_hash, cve_id, target, exploit_status",
    )
    .gte("published_at", cut7)
    .order("published_at", { ascending: false });
  const rows = allRows ?? [];
  const intel = rows.filter((r) => r.kind === "research");
  const vulns = rows.filter((r) => r.kind === "exploit");
  const breaches = rows.filter((r) => r.kind === "breach");

  const emptyWindow = (): WindowCounts => ({
    nationState: 0,
    ecrime: 0,
    vulns: 0,
    byActor: {},
  });
  const w24 = emptyWindow();
  const w7 = emptyWindow();

  for (const i of intel ?? []) {
    const isNation = i.motivation === "nation_state";
    const label = i.country ?? (isNation ? "Non Attributed" : "Unattributed");

    for (const [w, cut] of [
      [w7, cut7],
      [w24, cut1],
    ] as const) {
      if ((i.published_at ?? "") < cut) continue;
      if (isNation) w.nationState++;
      w.byActor[label] = (w.byActor[label] ?? 0) + 1;
    }
  }

  for (const v of vulns) {
    w7.vulns++;
    if ((v.published_at ?? "") >= cut1) w24.vulns++;
  }
  for (const b of breaches) {
    w7.ecrime++;
    if ((b.published_at ?? "") >= cut1) w24.ecrime++;
  }

  const vuln7d = { confirmed: 0, poc: 0, suspected: 0 };
  for (const v of vulns) {
    const s = v.exploit_status ?? "";
    if (s in vuln7d) vuln7d[s as keyof typeof vuln7d]++;
  }

  const notable: NotableItem[] = (intel ?? []).slice(0, 12).map((i) => {
    return {
      title: i.title,
      actor:
        i.country ??
        (i.motivation === "nation_state" ? "Non Attributed" : "Unattributed"),
      type: i.kind ?? "research",
      date: i.published_at ?? "",
      cs: i.crowdstrike_adversary,
    };
  });

  // Linkable items the summary can cite: recent reports, plus vulns (deduped by
  // CVE) and breaches. Sequential ids become the "[n]" markers in the prose.
  const linkables: LinkableItem[] = [];
  let id = 1;
  for (const i of (intel ?? []).slice(0, 14)) {
    linkables.push({
      id: id++,
      kind: "report",
      title: i.title,
      url: i.url,
      description: i.description,
      sourceName: i.source_name,
      date: i.published_at,
      rawHash: i.raw_hash,
    });
  }
  const seenCve = new Set<string>();
  for (const v of vulns) {
    const cve = v.cve_id ?? v.title;
    if (seenCve.has(cve)) continue;
    seenCve.add(cve);
    if (linkables.filter((l) => l.kind === "vuln").length >= 10) break;
    linkables.push({
      id: id++,
      kind: "vuln",
      title: v.target ? `${cve} - ${v.target}` : cve,
      url: v.url,
      description: v.description,
      sourceName: v.source_name,
      date: v.published_at,
      rawHash: v.raw_hash,
    });
  }
  for (const b of breaches.slice(0, 8)) {
    linkables.push({
      id: id++,
      kind: "breach",
      title: b.title,
      url: b.url,
      description: b.description,
      sourceName: b.source_name,
      date: b.published_at,
      rawHash: b.raw_hash,
    });
  }

  return { last24h: w24, last7d: w7, vuln7d, notable, linkables };
}
