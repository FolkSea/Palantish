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
  period: "last24h" | "days2to7" | "days8to30";
  title: string;
  url: string | null;
  description: string | null;
  reportSummary: string | null;
  actor: string | null;
  itemType: string | null;
  sourceName: string | null;
  date: string | null;
  rawHash: string | null;
};

export type Aggregates = {
  last24h: WindowCounts;
  last7d: WindowCounts;
  last30d: WindowCounts;
  vuln7d: { confirmed: number; poc: number; suspected: number };
  vuln30d: { confirmed: number; poc: number; suspected: number };
  notable: NotableItem[];
  linkables: LinkableItem[];
};

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

function oneLine(value: string | null | undefined, max = 520): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function formatSummaryEvidence(items: LinkableItem[]): string {
  return items
    .map((item) => {
      const synopsis = oneLine(item.reportSummary || item.description);
      return (
        `[${item.id}] window=${item.period}; date=${item.date ?? "unknown"}; ` +
        `kind=${item.kind}; type=${item.itemType ?? "unknown"}; ` +
        `attribution=${oneLine(item.actor, 100) || "unattributed"}; ` +
        `source=${oneLine(item.sourceName, 100) || "unknown"}; ` +
        `title=${oneLine(item.title, 240)}; ` +
        `synopsis=${synopsis || "No synopsis available."}`
      );
    })
    .join("\n");
}

export async function computeAggregates(db: Db): Promise<Aggregates> {
  const cut30 = isoDaysAgo(30);
  const cut7 = isoDaysAgo(7);
  const cut1 = isoDaysAgo(1);

  // Every report lives in intel_items now; partition by kind.
  const { data: allRows } = await db
    .from("intel_items")
    .select(
      "kind, title, item_type, motivation, country, crowdstrike_adversary, adversary_label, published_at, url, description, report_summary, source_name, raw_hash, cve_id, target, exploit_status",
    )
    .gte("published_at", cut30)
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
  const w30 = emptyWindow();

  for (const i of intel ?? []) {
    const isNation = i.motivation === "nation_state";
    const label = i.country ?? (isNation ? "Non Attributed" : "Unattributed");

    for (const [w, cut] of [
      [w7, cut7],
      [w24, cut1],
      [w30, cut30],
    ] as const) {
      if ((i.published_at ?? "") < cut) continue;
      if (isNation) w.nationState++;
      w.byActor[label] = (w.byActor[label] ?? 0) + 1;
    }
  }

  for (const v of vulns) {
    w30.vulns++;
    if ((v.published_at ?? "") >= cut7) w7.vulns++;
    if ((v.published_at ?? "") >= cut1) w24.vulns++;
  }
  for (const b of breaches) {
    w30.ecrime++;
    if ((b.published_at ?? "") >= cut7) w7.ecrime++;
    if ((b.published_at ?? "") >= cut1) w24.ecrime++;
  }

  const vuln7d = { confirmed: 0, poc: 0, suspected: 0 };
  const vuln30d = { confirmed: 0, poc: 0, suspected: 0 };
  for (const v of vulns) {
    const s = v.exploit_status ?? "";
    if (s in vuln30d) vuln30d[s as keyof typeof vuln30d]++;
    if ((v.published_at ?? "") >= cut7 && s in vuln7d)
      vuln7d[s as keyof typeof vuln7d]++;
  }

  const notable: NotableItem[] = (intel ?? [])
    .filter((i) => (i.published_at ?? "") >= cut7)
    .slice(0, 12)
    .map((i) => {
      return {
        title: i.title,
        actor:
          i.country ??
          (i.motivation === "nation_state"
            ? "Non Attributed"
            : "Unattributed"),
        type: i.kind ?? "research",
        date: i.published_at ?? "",
        cs: i.crowdstrike_adversary,
      };
    });

  // Evidence is balanced across the immediate briefing window, the rest of the
  // current week, and the preceding 30-day baseline. This gives the model report
  // substance rather than only titles and scoreboard counts.
  const linkables: LinkableItem[] = [];
  const seenHashes = new Set<string>();
  let id = 1;
  const addWindow = (
    period: LinkableItem["period"],
    lower: string,
    upper: string | null,
    limit: number,
  ) => {
    let added = 0;
    for (const row of rows) {
      if (added >= limit) break;
      const date = row.published_at ?? "";
      if (date < lower || (upper && date >= upper)) continue;
      const dedupeKey = row.raw_hash ?? row.url ?? `${row.kind}:${row.title}`;
      if (seenHashes.has(dedupeKey)) continue;
      seenHashes.add(dedupeKey);
      const kind: LinkableItem["kind"] =
        row.kind === "exploit"
          ? "vuln"
          : row.kind === "breach"
            ? "breach"
            : "report";
      const cve = row.cve_id ?? row.title;
      linkables.push({
        id: id++,
        kind,
        period,
        title: kind === "vuln" && row.target ? `${cve} - ${row.target}` : row.title,
        url: row.url,
        description: row.description,
        reportSummary: row.report_summary,
        actor:
          row.adversary_label ??
          row.crowdstrike_adversary ??
          row.country ??
          null,
        itemType: row.item_type,
        sourceName: row.source_name,
        date: row.published_at,
        rawHash: row.raw_hash,
      });
      added++;
    }
  };
  addWindow("last24h", cut1, null, 18);
  addWindow("days2to7", cut7, cut1, 18);
  addWindow("days8to30", cut30, cut7, 16);

  return {
    last24h: w24,
    last7d: w7,
    last30d: w30,
    vuln7d,
    vuln30d,
    notable,
    linkables,
  };
}
