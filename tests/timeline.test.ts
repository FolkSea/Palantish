import { describe, it, expect } from "vitest";
import {
  buildTimeline,
  eventVisible,
  DEFAULT_FILTERS,
  UNID_NATION,
  UNID_ECRIME,
  UNID_HACKTIVISM,
  POC_COLOR,
  BREACH_COLOR,
  UNID_COLOR,
  type TimelineFilters,
} from "@/lib/timeline";
import { buildHacktivismGroups } from "@/lib/ingest/enrich/rules";
import { buildEcrimeActorGroups } from "@/lib/ecrime";
import type { Database } from "@/lib/supabase/database.types";

type IntelItemRow = Database["public"]["Tables"]["intel_items"]["Row"];

let seq = 0;
function intel(p: Partial<IntelItemRow>): IntelItemRow {
  seq += 1;
  return {
    id: `i-${seq}`,
    kind: "research",
    title: "t",
    description: "",
    url: null,
    source_name: "src",
    published_at: "2026-07-20",
    motivation: null,
    country: null,
    crowdstrike_adversary: null,
    adversary_label: null,
    cve_id: null,
    target: null,
    exploit_status: null,
    raw_hash: `hi-${seq}`,
    ...p,
  } as IntelItemRow;
}
// Breaches/exploits are intel_items rows now; these translate the old-style
// fields (org_name/summary, status/added_at/detail) onto the unified columns.
function breach(
  p: { org_name?: string; summary?: string } & Partial<IntelItemRow> = {},
): IntelItemRow {
  const { org_name, summary, ...rest } = p;
  return intel({
    kind: "breach",
    title: org_name ?? "org",
    description: summary ?? "",
    ...rest,
  });
}
function vuln(
  p: { status?: string; added_at?: string; detail?: string } & Partial<IntelItemRow> = {},
): IntelItemRow {
  const { status, added_at, detail, ...rest } = p;
  return intel({
    kind: "exploit",
    cve_id: "CVE-2026-0001",
    target: "Acme",
    title: "CVE-2026-0001",
    exploit_status: status ?? "poc",
    published_at: added_at ?? "2026-07-20",
    description: detail ?? "",
    ...rest,
  });
}

const ecrimeGroups = buildEcrimeActorGroups([]);
const hacktivismGroups = buildHacktivismGroups();

function run(
  intelRows: IntelItemRow[] = [],
  breachRows: IntelItemRow[] = [],
  vulnRows: IntelItemRow[] = [],
) {
  return buildTimeline(
    [...intelRows, ...breachRows, ...vulnRows],
    ecrimeGroups,
    hacktivismGroups,
  );
}

describe("buildTimeline", () => {
  it("puts a named nation-state report on its actor lane", () => {
    const { events, streams } = run([
      intel({ motivation: "nation_state", crowdstrike_adversary: "COZY BEAR" }),
    ]);
    expect(events[0]).toMatchObject({
      actor: "COZY BEAR",
      category: "nation_state",
      kind: "report",
    });
    expect(streams.map((s) => s.actor)).toContain("COZY BEAR");
  });

  it("collapses unattributed nation-state to UNID BAT", () => {
    const { events } = run([intel({ motivation: "nation_state" })]);
    expect(events[0].actor).toBe(UNID_NATION);
  });

  it("collapses unattributed eCrime to UNID SPIDER, hacktivism to UNID JACKAL", () => {
    const { events } = run([
      intel({ motivation: "ecrime" }),
      intel({ motivation: "hacktivism" }),
    ]);
    expect(events[0].actor).toBe(UNID_ECRIME);
    expect(events[1].actor).toBe(UNID_HACKTIVISM);
  });

  it("puts a breach with no crew on the neutral Breaches lane, not eCrime", () => {
    const { events, streams } = run([], [breach({ summary: "data theft, no crew" })]);
    expect(events[0]).toMatchObject({ actor: "Breaches", category: "breach", kind: "breach" });
    const lane = streams.find((s) => s.actor === "Breaches");
    expect(lane?.category).toBe("breach");
    expect(lane?.color).toBe(BREACH_COLOR);
  });

  it("keeps an eCrime-attributed breach on the crew's eCrime lane", () => {
    const { events } = run([], [breach({ summary: "LockBit ransomware hit Acme" })]);
    expect(events[0]).toMatchObject({ category: "ecrime", actor: "LockBit", kind: "breach" });
  });

  it("honours a stored breach attribution over the derived crew", () => {
    const { events } = run([], [breach({ adversary_label: "Toy Ghouls" })]);
    expect(events[0].actor).toBe("Toy Ghouls");
  });

  it("routes a hacktivist-named breach to the hacktivism category", () => {
    const { events } = run([], [breach({ org_name: "Gov", summary: "KillNet DDoS" })]);
    expect(events[0]).toMatchObject({ category: "hacktivism", actor: "KillNet" });
  });

  it("puts exploits on a single Exploits lane", () => {
    const { events, streams } = run([], [], [vuln({}), vuln({})]);
    expect(events.every((e) => e.actor === "Exploits" && e.kind === "exploit")).toBe(true);
    expect(streams.filter((s) => s.category === "exploit")).toHaveLength(1);
  });

  it("shows only exploits with a PoC (drops confirmed/suspected)", () => {
    const { events, streams } = run(
      [],
      [],
      [vuln({ status: "poc" }), vuln({ status: "confirmed" }), vuln({ status: "suspected" })],
    );
    expect(events.filter((e) => e.category === "exploit")).toHaveLength(1);
    expect(streams.filter((s) => s.category === "exploit")).toHaveLength(1);
  });

  it("orders lanes nation-state, eCrime, hacktivism, exploits", () => {
    const { streams } = run(
      [intel({ motivation: "nation_state", crowdstrike_adversary: "COZY BEAR" })],
      [breach({ summary: "LockBit ransomware" })],
      [vuln({})],
    );
    expect(streams.map((s) => s.category)).toEqual([
      "nation_state",
      "ecrime",
      "exploit",
    ]);
  });

  it("gives each named actor a distinct colour", () => {
    const { streams } = run([
      intel({ motivation: "nation_state", crowdstrike_adversary: "COZY BEAR" }),
      intel({ motivation: "ecrime", crowdstrike_adversary: "WICKED SPIDER" }),
    ]);
    const colors = streams.map((s) => s.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("reserves red for exploits, grey for unattributed, and keeps them off actors", () => {
    const { streams } = run(
      [
        intel({ motivation: "nation_state", crowdstrike_adversary: "COZY BEAR" }),
        intel({ motivation: "nation_state" }), // UNID BAT
      ],
      [],
      [vuln({ status: "poc" })],
    );
    const colorOf = (actor: string) =>
      streams.find((s) => s.actor === actor)?.color;
    expect(colorOf("Exploits")).toBe(POC_COLOR);
    expect(colorOf(UNID_NATION)).toBe(UNID_COLOR);
    // Named actors never use the reserved PoC / breach colours.
    const named = streams.filter(
      (s) => s.category !== "exploit" && !s.actor.startsWith("UNID"),
    );
    for (const s of named) {
      expect(s.color).not.toBe(POC_COLOR);
      expect(s.color).not.toBe(BREACH_COLOR);
      expect(s.color).not.toBe(UNID_COLOR);
    }
  });
});

describe("eventVisible", () => {
  const base = { id: "x", date: "2026-07-20", title: "t", description: null, source: null, url: null };
  const off = (k: keyof TimelineFilters): TimelineFilters => ({ ...DEFAULT_FILTERS, [k]: false });

  it("shows everything by default", () => {
    const e = { ...base, actor: "A", category: "ecrime", kind: "breach" } as const;
    expect(eventVisible(e, DEFAULT_FILTERS)).toBe(true);
  });

  it("hides breaches when the Breaches toggle is off", () => {
    const e = { ...base, actor: "A", category: "ecrime", kind: "breach" } as const;
    expect(eventVisible(e, off("breaches"))).toBe(false);
    // an eCrime report is still shown
    const r = { ...base, actor: "A", category: "ecrime", kind: "report" } as const;
    expect(eventVisible(r, off("breaches"))).toBe(true);
  });

  it("hides a whole category when its toggle is off", () => {
    const e = { ...base, actor: UNID_NATION, category: "nation_state", kind: "report" } as const;
    expect(eventVisible(e, off("nation_state"))).toBe(false);
  });

  it("gates exploits solely on the Exploits toggle", () => {
    const e = { ...base, actor: "Exploits", category: "exploit", kind: "exploit" } as const;
    expect(eventVisible(e, off("exploits"))).toBe(false);
    expect(eventVisible(e, off("breaches"))).toBe(true);
  });

  it("gates the neutral Breaches lane on the Breaches toggle, not eCrime", () => {
    const e = { ...base, actor: "Breaches", category: "breach", kind: "breach" } as const;
    expect(eventVisible(e, off("breaches"))).toBe(false);
    expect(eventVisible(e, off("ecrime"))).toBe(true);
  });
});
