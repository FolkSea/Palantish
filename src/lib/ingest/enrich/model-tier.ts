// Which model enriches a candidate.
//
// Most of a backlog is vulnerability records - CVE bulletins and vendor
// advisories - where the work is extraction rather than judgement: the CVE id,
// the affected product, whether a PoC exists. Those go to the cheap model.
// Anything that reads like actor reporting keeps the strong one, because
// attribution is where a mistake propagates: it drives the timeline lanes, the
// actor cards, subscription matching, and the actor edges in the graph, and
// nothing re-enriches a report once raw_hash dedupe has seen it.
//
// Pure, so the routing rule is testable without a model or a network.

import type { RawCandidate } from "../types";
import { matchGroup, type GroupEntry } from "./rules";

export type ModelTier = "cheap" | "standard";

/** CVE ids in the title - the strongest signal a candidate is a vuln record. */
const CVE_RE = /\bCVE-\d{4}-\d{4,7}\b/i;

// The subject is a vulnerability, in the languages the feeds actually publish
// in. Title only: a research post that merely mentions a vulnerability in its
// body is real reporting and must not be downgraded.
const ADVISORY_RE =
  /\bvulnerabilit(?:y|ies|es?)\b|\bsecurity (?:advisory|bulletin|update)s?\b|\bpatch tuesday\b|\bcritical patch update\b|\bsecurity release\b/i;

// A named actor in the title means judgement is needed however advisory-ish the
// rest of it looks - "Ivanti vulnerability exploited by UNC5221" is reporting.
// The generic designator forms only; real names come from the catalogue, which
// the caller passes in. A hardcoded list of crews was tried first and missed
// DragonForce on the very first pass over real titles.
const ACTOR_DESIGNATOR_RE = /\bAPT\s?\d+\b|\bUNC\d{3,}\b|\bTA\d{3,}\b/i;

/**
 * The tier for one candidate.
 *
 * Conservative by design: anything not clearly a vulnerability record gets the
 * standard model. Sending real reporting to the cheap model costs attribution
 * quality permanently, while sending a CVE bulletin to the strong one costs
 * only money.
 */
export function modelTierFor(
  c: RawCandidate,
  /** Catalogue actors, so a named crew keeps the strong model. */
  actors: GroupEntry[] = [],
): ModelTier {
  const title = c.title ?? "";
  if (ACTOR_DESIGNATOR_RE.test(title)) return "standard";
  // Same word-boundary matching the rules enricher uses, against the same
  // catalogue - so "Dragonforce Ransomware" is recognised as reporting without
  // anyone maintaining a second list of names.
  if (actors.length > 0 && matchGroup(title.toLowerCase(), actors)) {
    return "standard";
  }
  if (CVE_RE.test(title)) return "cheap";
  if (ADVISORY_RE.test(title)) return "cheap";
  return "standard";
}

/**
 * The model id for a tier.
 *
 * The cheap model cannot use the enhanced web_fetch tool - the tool version is
 * chosen by a model regex that matches only the larger models - but it does
 * support the basic one, which was verified against the live API before this
 * was switched on.
 */
export function modelForTier(tier: ModelTier): string | undefined {
  if (tier === "cheap") {
    return (
      process.env.ANTHROPIC_CHEAP_MODEL || "claude-haiku-4-5-20251001"
    );
  }
  // undefined means "whatever the agent defaults to", so the standard path is
  // untouched and keeps honouring ANTHROPIC_MODEL.
  return undefined;
}
