"use server";

import { ensureAuthenticated } from "@/lib/auth";
import {
  loadActorCardPage,
  loadBreachesPage,
  loadReportsPage,
  loadVulnerabilitiesPage,
  type ActorSection,
  type BreachRow,
  type LabeledIntelRow,
  type ActorItem,
  type Page,
} from "@/lib/data";
import type { PrioritisedVuln } from "@/lib/vuln-priority";

// Page sizes the footer offers, plus the actor cards' five. Anything else is
// rounded down to the largest offered size: this is a server action, so the
// size arrives from a POST body and "give me a million rows" is a request the
// server should not honour just because it was asked politely.
const SIZES = [5, 10, 25, 50];
const MAX_SIZE = Math.max(...SIZES);

function clampSize(size: number | null): number | null {
  // null is the footer's "All", which is a deliberate choice by the reader.
  if (size === null) return null;
  const n = Math.trunc(Number(size));
  if (!Number.isFinite(n) || n <= 0) return SIZES[1];
  return Math.min(n, MAX_SIZE);
}

function clampPage(page: number): number {
  const n = Math.trunc(Number(page));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const EMPTY = { rows: [], total: 0 };

export async function reportsPageAction(
  page: number,
  size: number | null,
): Promise<Page<LabeledIntelRow>> {
  if (await ensureAuthenticated()) return EMPTY;
  return loadReportsPage(clampPage(page), clampSize(size));
}

export async function breachesPageAction(
  page: number,
  size: number | null,
): Promise<Page<BreachRow>> {
  if (await ensureAuthenticated()) return EMPTY;
  return loadBreachesPage(clampPage(page), clampSize(size));
}

export async function vulnerabilitiesPageAction(
  page: number,
  size: number | null,
): Promise<Page<PrioritisedVuln>> {
  if (await ensureAuthenticated()) return EMPTY;
  return loadVulnerabilitiesPage(clampPage(page), clampSize(size));
}

const SECTIONS: ActorSection[] = ["nation_state", "ecrime", "hacktivism"];

export async function actorCardPageAction(
  section: ActorSection,
  key: string,
  page: number,
  size: number | null,
): Promise<Page<ActorItem>> {
  if (await ensureAuthenticated()) return EMPTY;
  if (!SECTIONS.includes(section)) return EMPTY;
  return loadActorCardPage(section, key, clampPage(page), clampSize(size));
}
