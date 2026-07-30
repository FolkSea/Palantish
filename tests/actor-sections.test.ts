import { describe, it, expect } from "vitest";
import {
  buildActorSectionCards,
  buildHacktivismGroups,
} from "@/lib/actor-sections";
import { buildEcrimeActorGroups } from "@/lib/ecrime";
import type { Database } from "@/lib/supabase/database.types";

type IntelItemRow = Database["public"]["Tables"]["intel_items"]["Row"];

let seq = 0;
function report(p: Partial<IntelItemRow>): IntelItemRow {
  seq += 1;
  return {
    id: `i-${seq}`,
    title: "t",
    description: "",
    url: null,
    raw_hash: `hi-${seq}`,
    source_name: "src",
    published_at: "2026-07-20",
    item_type: "report",
    motivation: null,
    country: null,
    crowdstrike_adversary: null,
    adversary_label: null,
    confidence: "medium",
    ...p,
  } as IntelItemRow;
}

const ecrimeGroups = buildEcrimeActorGroups([]);
const hacktivismGroups = buildHacktivismGroups();

function run(reports: IntelItemRow[]) {
  return buildActorSectionCards(reports, ecrimeGroups, hacktivismGroups);
}

describe("buildActorSectionCards (reports only)", () => {
  it("attributes an eCrime report to its named crew", () => {
    const { ecrimeCards } = run([
      report({ title: "LockBit unpacked", description: "analysis of LockBit tooling" }),
    ]);
    expect(ecrimeCards[0].label).toBe("LockBit");
    expect(ecrimeCards[0].items[0].adversary).toBe("LockBit");
  });

  it("uses the stored motivation + name when present", () => {
    const { ecrimeCards } = run([
      report({ title: "GenieLocker analysis", motivation: "ecrime", crowdstrike_adversary: "Toy Ghouls" }),
    ]);
    expect(ecrimeCards[0].label).toBe("Toy Ghouls");
  });

  it("puts an unattributed eCrime report in the Non Attributed card (UNID SPIDER)", () => {
    const { ecrimeCards } = run([
      report({ title: "eCrime trends", motivation: "ecrime" }),
    ]);
    expect(ecrimeCards.map((c) => c.label)).toEqual(["Non Attributed"]);
    expect(ecrimeCards[0].items[0].adversary).toBe("UNID SPIDER");
  });

  it("routes a hacktivist-named report to hacktivism, not eCrime", () => {
    const { ecrimeCards, hacktivismCards } = run([
      report({ title: "KillNet DDoS analysis", description: "the hacktivist collective" }),
    ]);
    expect(ecrimeCards).toHaveLength(0);
    expect(hacktivismCards[0].label).toBe("KillNet");
  });

  it("puts a generic hacktivism report in hacktivism Non Attributed (UNID JACKAL)", () => {
    const { hacktivismCards } = run([
      report({ title: "Hacktivists deface ministry site", description: "a hacktivist group claimed it" }),
    ]);
    expect(hacktivismCards.map((c) => c.label)).toEqual(["Non Attributed"]);
    expect(hacktivismCards[0].items[0].adversary).toBe("UNID JACKAL");
  });

  it("orders named actors before Non Attributed, by report count", () => {
    const { ecrimeCards } = run([
      report({ title: "Qilin analysis", motivation: "ecrime", crowdstrike_adversary: "Qilin" }),
      report({ title: "LockBit analysis", motivation: "ecrime", crowdstrike_adversary: "LockBit" }),
      report({ title: "LockBit again", motivation: "ecrime", crowdstrike_adversary: "LockBit" }),
      report({ title: "eCrime roundup", motivation: "ecrime" }),
    ]);
    expect(ecrimeCards.map((c) => c.label)).toEqual([
      "LockBit",
      "Qilin",
      "Non Attributed",
    ]);
  });

  it("does not show a report with no eCrime/hacktivism signal in these sections", () => {
    const { ecrimeCards, hacktivismCards } = run([
      report({ title: "A normal vendor report", description: "nothing here" }),
    ]);
    expect(ecrimeCards).toHaveLength(0);
    expect(hacktivismCards).toHaveLength(0);
  });
});
