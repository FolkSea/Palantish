import type { VulnPriority } from "@/lib/badges";
import type { VulnerabilityRow } from "@/lib/data";

export type VulnStatus = "confirmed" | "suspected" | "poc";

/** One CVE, aggregated across all of its reports, with a derived priority. */
export type PrioritisedVuln = {
  cve_id: string;
  target: string | null;
  detail: string | null;
  url: string | null;
  source_name: string | null;
  added_at: string; // most recent report's publication date (primary recency)
  created_at: string; // latest ingestion timestamp, breaks same-day ties
  statuses: VulnStatus[]; // distinct contributing statuses (poc, confirmed, suspected)
  reportCount: number;
  priority: VulnPriority;
};

const PRIORITY_ORDER: Record<VulnPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
};

// Newest first; date strings are ISO (YYYY-MM-DD) so lexical compare is fine.
function cmpDateDesc(a: string, b: string): number {
  return b.localeCompare(a);
}

function firstNonNull<T>(
  rows: VulnerabilityRow[],
  pick: (r: VulnerabilityRow) => T | null | undefined,
): T | null {
  for (const r of rows) {
    const v = pick(r);
    if (v != null) return v;
  }
  return null;
}

/**
 * Collapse vulnerability reports to one row per CVE and assign a priority from
 * the set of statuses present across that CVE's reports:
 *
 *   Critical - has both a POC report AND a Confirmed report
 *   High     - has a POC report (but none confirmed)
 *   Medium   - has a Confirmed report (but no POC)
 *   Low      - anything else (only suspected); dropped from the result
 *
 * The result is sorted by priority (Critical -> High -> Medium), then by most
 * recent report date. Low-priority CVEs are filtered out entirely.
 */
export function prioritiseVulns(rows: VulnerabilityRow[]): PrioritisedVuln[] {
  const groups = new Map<string, VulnerabilityRow[]>();
  for (const r of rows) {
    const key = (r.cve_id ?? "").trim().toUpperCase();
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) existing.push(r);
    else groups.set(key, [r]);
  }

  const result: PrioritisedVuln[] = [];
  for (const group of groups.values()) {
    const present = new Set(group.map((g) => g.status));
    const hasPoc = present.has("poc");
    const hasConfirmed = present.has("confirmed");

    let priority: VulnPriority | null = null;
    if (hasPoc && hasConfirmed) priority = "critical";
    else if (hasPoc) priority = "high";
    else if (hasConfirmed) priority = "medium";
    if (!priority) continue; // Low priority -> filtered out

    // Representative display fields come from the most recent report, falling
    // back to any non-null value elsewhere in the group.
    const byRecent = [...group].sort((a, b) => cmpDateDesc(a.added_at, b.added_at));
    const rep = byRecent[0];
    const statuses = (["poc", "confirmed", "suspected"] as VulnStatus[]).filter(
      (s) => present.has(s),
    );
    // Latest ingestion timestamp across the CVE's reports, used to break
    // same-publication-date ties so the freshest item still sorts first.
    const latestCreated = group.reduce(
      (max, r) => (r.created_at > max ? r.created_at : max),
      group[0].created_at,
    );

    result.push({
      cve_id: rep.cve_id,
      target: rep.target ?? firstNonNull(byRecent, (r) => r.target),
      detail: rep.detail ?? firstNonNull(byRecent, (r) => r.detail),
      url: rep.url ?? firstNonNull(byRecent, (r) => r.url),
      source_name: rep.source_name ?? firstNonNull(byRecent, (r) => r.source_name),
      added_at: rep.added_at,
      created_at: latestCreated,
      statuses,
      reportCount: group.length,
      priority,
    });
  }

  // Sort by priority, then most-recent-first within each priority: publication
  // date, then ingestion timestamp (breaks same-day ties), then CVE id (stable).
  result.sort(
    (a, b) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      cmpDateDesc(a.added_at, b.added_at) ||
      cmpDateDesc(a.created_at, b.created_at) ||
      a.cve_id.localeCompare(b.cve_id),
  );
  return result;
}
