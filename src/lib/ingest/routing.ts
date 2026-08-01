import { hasHacktivismKeyword } from "./enrich/rules";
import type { EnrichedItem } from "./types";

export type ReportKind = "research" | "breach" | "exploit" | "other";

const CVE_RE = /\bCVE-\d{4}-\d{3,7}\b/i;

export function findCve(item: Pick<EnrichedItem, "title" | "description">) {
  return `${item.title} ${item.description ?? ""}`.match(CVE_RE)?.[0].toUpperCase() ?? null;
}

export function resolveReportKind(
  item: EnrichedItem,
  attributed: boolean,
  hasCve: boolean,
): ReportKind {
  if (item.itemType === "vuln" && hasCve) return "exploit";
  if (item.itemType === "breach") return "breach";

  const text = `${item.title} ${item.description ?? ""}`;
  if (
    attributed ||
    item.crowdstrikeAdversary ||
    item.itemType === "actor_activity" ||
    hasHacktivismKeyword(text)
  ) {
    return "research";
  }

  // Use the model's dashboard choice only when deterministic evidence has not
  // already selected a section. An exploit still requires a real CVE.
  if (item.dashboardKind === "exploit") return hasCve ? "exploit" : "other";
  return item.dashboardKind ?? "other";
}
