import { describe, it, expect } from "vitest";
import {
  buildActorSectionCards,
  buildHacktivismGroups,
} from "@/lib/actor-sections";
import { buildEcrimeActorGroups } from "@/lib/ecrime";
import type { Database } from "@/lib/supabase/database.types";

type BreachRow = Database["public"]["Tables"]["breaches"]["Row"];
type IntelItemRow = Database["public"]["Tables"]["intel_items"]["Row"];

let seq = 0;
function breach(org_name: string, summary = ""): BreachRow {
  seq += 1;
  return {
    id: `b-${seq}`,
    org_name,
    summary,
    url: null,
    source_name: "src",
    source_id: null,
    event_date: "2026-07-20",
    event_date_label: null,
    raw_hash: `h-${seq}`,
    created_at: "",
    updated_at: "",
  } as BreachRow;
}
function report(title: string, description = ""): IntelItemRow {
  seq += 1;
  return {
    id: `i-${seq}`,
    title,
    description,
    url: null,
    raw_hash: `hi-${seq}`,
    source_name: "src",
    published_at: "2026-07-20",
  } as IntelItemRow;
}

const ecrimeGroups = buildEcrimeActorGroups([]);
const hacktivismGroups = buildHacktivismGroups();

function run(breaches: BreachRow[], reports: IntelItemRow[] = []) {
  return buildActorSectionCards(breaches, reports, ecrimeGroups, hacktivismGroups);
}

describe("buildActorSectionCards", () => {
  it("attributes a breach to a named eCrime crew", () => {
    const { ecrimeCards } = run([breach("Acme Corp", "LockBit ransomware hit Acme")]);
    expect(ecrimeCards[0].name).toBe("LockBit");
    expect(ecrimeCards[0].items).toHaveLength(1);
  });

  it("puts an unattributed breach in the eCrime Unattributed card", () => {
    const { ecrimeCards } = run([breach("Beta Ltd", "data theft, no crew named")]);
    expect(ecrimeCards.map((c) => c.name)).toEqual(["Unattributed"]);
  });

  it("routes a hacktivist-named breach to hacktivism, not eCrime", () => {
    const { ecrimeCards, hacktivismCards } = run([
      breach("Gov Portal", "KillNet claimed a DDoS against the portal"),
    ]);
    expect(ecrimeCards).toHaveLength(0);
    expect(hacktivismCards[0].name).toBe("KillNet");
  });

  it("puts a generic hacktivism report in hacktivism Unattributed", () => {
    const { hacktivismCards } = run(
      [],
      [report("Hacktivists deface ministry site", "A hacktivist group claimed it")],
    );
    expect(hacktivismCards.map((c) => c.name)).toEqual(["Unattributed"]);
  });

  it("orders named actors before Unattributed, by report count", () => {
    const { ecrimeCards } = run([
      breach("A", "Qilin ransomware"),
      breach("B", "LockBit ransomware"),
      breach("C", "LockBit again"),
      breach("D", "no attribution"),
    ]);
    expect(ecrimeCards.map((c) => c.name)).toEqual([
      "LockBit",
      "Qilin",
      "Unattributed",
    ]);
  });

  it("does not treat plain reports without hacktivism signal as hacktivism", () => {
    const { hacktivismCards } = run([], [report("A normal vendor report", "nothing here")]);
    expect(hacktivismCards).toHaveLength(0);
  });
});
