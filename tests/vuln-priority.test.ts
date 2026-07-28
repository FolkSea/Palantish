import { describe, it, expect } from "vitest";
import { prioritiseVulns } from "@/lib/vuln-priority";
import type { VulnerabilityRow } from "@/lib/data";

let seq = 0;
function row(
  cve_id: string,
  status: "confirmed" | "suspected" | "poc",
  added_at = "2026-07-20",
  extra: Partial<VulnerabilityRow> = {},
): VulnerabilityRow {
  seq += 1;
  return {
    id: `id-${seq}`,
    cve_id,
    target: `target-${seq}`,
    status,
    detail: `detail-${seq}`,
    url: `https://example.test/${seq}`,
    source_name: `src-${seq}`,
    source_id: null,
    raw_hash: `hash-${seq}`,
    added_at,
    created_at: `${added_at}T00:00:00Z`,
    updated_at: `${added_at}T00:00:00Z`,
    ...extra,
  } as VulnerabilityRow;
}

describe("prioritiseVulns", () => {
  it("marks a CVE with both POC and Confirmed reports as Critical", () => {
    const out = prioritiseVulns([
      row("CVE-2026-1", "poc"),
      row("CVE-2026-1", "confirmed"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].priority).toBe("critical");
    expect(out[0].reportCount).toBe(2);
    expect(out[0].statuses.sort()).toEqual(["confirmed", "poc"]);
  });

  it("maps POC-only to High and Confirmed-only to Medium", () => {
    const out = prioritiseVulns([
      row("CVE-2026-2", "poc"),
      row("CVE-2026-3", "confirmed"),
    ]);
    const byCve = Object.fromEntries(out.map((v) => [v.cve_id, v.priority]));
    expect(byCve["CVE-2026-2"]).toBe("high");
    expect(byCve["CVE-2026-3"]).toBe("medium");
  });

  it("filters out Low priority (suspected-only) CVEs", () => {
    const out = prioritiseVulns([
      row("CVE-2026-4", "suspected"),
      row("CVE-2026-4", "suspected"),
    ]);
    expect(out).toHaveLength(0);
  });

  it("a suspected report does not downgrade a POC+Confirmed CVE", () => {
    const out = prioritiseVulns([
      row("CVE-2026-5", "suspected"),
      row("CVE-2026-5", "poc"),
      row("CVE-2026-5", "confirmed"),
    ]);
    expect(out[0].priority).toBe("critical");
  });

  it("sorts Critical -> High -> Medium, then by most recent report", () => {
    const out = prioritiseVulns([
      row("CVE-MED", "confirmed", "2026-07-25"),
      row("CVE-HI-OLD", "poc", "2026-07-01"),
      row("CVE-HI-NEW", "poc", "2026-07-28"),
      row("CVE-CRIT", "poc", "2026-07-10"),
      row("CVE-CRIT", "confirmed", "2026-07-11"),
    ]);
    expect(out.map((v) => v.cve_id)).toEqual([
      "CVE-CRIT",
      "CVE-HI-NEW",
      "CVE-HI-OLD",
      "CVE-MED",
    ]);
  });

  it("breaks same-publication-date ties by ingestion time (newest first)", () => {
    const out = prioritiseVulns([
      row("CVE-SAME-A", "confirmed", "2026-07-28", {
        created_at: "2026-07-28T09:44:35Z",
      }),
      row("CVE-SAME-B", "confirmed", "2026-07-28", {
        created_at: "2026-07-28T10:05:11Z",
      }),
    ]);
    // Same added_at, so the later created_at (B) must come first.
    expect(out.map((v) => v.cve_id)).toEqual(["CVE-SAME-B", "CVE-SAME-A"]);
  });

  it("uses the latest report's ingestion time for the tie-break", () => {
    const out = prioritiseVulns([
      row("CVE-MULTI", "poc", "2026-07-28", {
        created_at: "2026-07-28T08:00:00Z",
      }),
      row("CVE-MULTI", "confirmed", "2026-07-28", {
        created_at: "2026-07-28T12:00:00Z",
      }),
      row("CVE-SOLO", "poc", "2026-07-28", {
        created_at: "2026-07-28T10:00:00Z",
      }),
      row("CVE-SOLO", "confirmed", "2026-07-28", {
        created_at: "2026-07-28T11:00:00Z",
      }),
    ]);
    // Both critical, same date; CVE-MULTI's latest ingest (12:00) beats
    // CVE-SOLO's latest (11:00).
    expect(out.map((v) => v.cve_id)).toEqual(["CVE-MULTI", "CVE-SOLO"]);
  });

  it("groups CVE ids case-insensitively", () => {
    const out = prioritiseVulns([
      row("cve-2026-9", "poc"),
      row("CVE-2026-9", "confirmed"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].priority).toBe("critical");
  });

  it("uses the most recent report for representative fields", () => {
    const out = prioritiseVulns([
      row("CVE-2026-10", "poc", "2026-07-01", { target: "old" }),
      row("CVE-2026-10", "confirmed", "2026-07-20", { target: "new" }),
    ]);
    expect(out[0].target).toBe("new");
    expect(out[0].added_at).toBe("2026-07-20");
  });
});
