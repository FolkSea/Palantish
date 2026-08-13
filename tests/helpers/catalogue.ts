import { buildGroupsFromAdversaries } from "@/lib/ingest/adversaries";
import { sortGroups, type GroupEntry } from "@/lib/ingest/enrich/rules";
import { CATALOGUE_FIXTURE } from "../fixtures/adversaries";

/**
 * The fixture actors as longest-alias-first matchers, built through the same
 * function the app uses - so a passing suite proves attribution works, without
 * the repository holding a copy of the catalogue that could be loaded over the
 * real one.
 */
export function catalogueGroups(): GroupEntry[] {
  return sortGroups(buildGroupsFromAdversaries(CATALOGUE_FIXTURE));
}
