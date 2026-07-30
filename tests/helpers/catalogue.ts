import { readFileSync } from "node:fs";
import {
  mapAdversaryRecords,
  buildGroupsFromAdversaries,
  type RawAdversaryRecord,
} from "@/lib/ingest/adversaries";
import { sortGroups, type GroupEntry } from "@/lib/ingest/enrich/rules";

// The committed catalogue is the single source of actor identity. Tests derive
// their matchers from it exactly as the loader and the app do, so a passing
// suite proves attribution works without any hard-coded actor table. Tests run
// from the repo root, so the relative path resolves.
const raw = JSON.parse(
  readFileSync("adversaries.json", "utf8"),
) as RawAdversaryRecord[];
const rows = mapAdversaryRecords(raw);

/** Every catalogue actor as a longest-alias-first matcher. */
export function catalogueGroups(): GroupEntry[] {
  return sortGroups(buildGroupsFromAdversaries(rows));
}
