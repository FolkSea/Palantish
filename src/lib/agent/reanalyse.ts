// Re-reading one report on demand: what to ask for, and how to read the answer.
//
// The ingest classifies a report once, from whatever the fetch returned at the
// time, and nothing re-enriches it afterwards - raw_hash dedupe means a report
// keeps its first classification for good. This is the way to ask for a second
// look at one report: the analyst pressed a button and is waiting, so it can
// afford to read the article properly rather than at ingest speed.
//
// The parsing is pure so the contract is testable without the API.

import { parseWebTriage, type WebTriageResult } from "./web-triage";

/**
 * What the model is asked for, over and above ordinary triage.
 *
 * Two things differ from ingest. Indicators are held to a higher bar, because
 * the result replaces what is stored rather than adding to it - a wrong one
 * here removes a right one. And visibility gaps are asked for at all, which
 * ingest never does.
 */
export const REANALYSE_INSTRUCTIONS = `Re-read this report and produce the analyst's record of it.

Fetch the report URL and work from the article itself, not from the title.

Return ONLY strict JSON:
{
  "summary": string,
  "nexus": "china" | "russia" | "north_korea" | "iran" | "rest_of_world" | "other" | null,
  "crowdstrikeAdversary": string | null,
  "confidence": "confirmed" | "suspected" | "poc",
  "itemType": "actor_activity" | "breach" | "vuln" | "report" | "breaking",
  "dashboardKind": "research" | "breach" | "exploit" | "other",
  "labels": { "malware": string[], "adversary": string[], "target": string[], "vector": string[], "ai": string[] },
  "indicators": {
    "ipv4": string[], "ipv6": string[], "domains": string[], "fileHashes": string[], "cves": string[]
  },
  "mitreTechniques": string[],
  "visibilityGaps": string,
  "evidence": [ { "value": string, "excerpt": string } ]
}

- summary: 2-4 plain ASCII sentences on what the report says: who did what, to whom, and how it was found.
- crowdstrikeAdversary: the named group, mapping a vendor alias to the name the industry knows (Twill Typhoon and Earth Preta are MUSTANG PANDA). Null when the report names none - do not guess one from the targeting or the nexus.
- labels: the malware, groups, targets and vectors the report actually names. A target is who was attacked; an adversary is who attacked them. In a supply-chain report the compromised product is the TARGET and the vector is SupplyChain.
- indicators: this REPLACES everything currently stored, so return a value only when it appears verbatim in the article AND the article presents it as attacker infrastructure or an attacker artefact. Leave out the vendor's own domain, links to its other articles, social and share links, CDN and analytics hosts, documentation and advisory URLs, and any address given as an example. If in doubt, leave it out: a missing indicator can be added by hand, a wrong one silently joins this report to unrelated ones in the link graph. Add an { value, excerpt } entry to "evidence" for every indicator, quoting the surrounding sentence.
- visibilityGaps: 1-3 plain ASCII sentences on what an operator could NOT detect or confirm from what this report gives them - telemetry the report does not cover, indicators it withholds, timeframes or victims it leaves vague. Empty string if the report leaves no material gap.

Use ASCII only. Do not invent actors, victims, malware, indicators or numbers.`;

export type ReanalysisResult = WebTriageResult & {
  /** What the report leaves an operator unable to see. Empty when none. */
  visibilityGaps: string;
};

/**
 * Read the model's answer.
 *
 * Built on the triage parser so the shared fields are validated exactly as they
 * are at ingest - a re-analysis that accepted a nexus or an item type the
 * ingest would have rejected would put a report into a state the pipeline
 * cannot produce.
 */
export function parseReanalysis(text: string): ReanalysisResult | null {
  const base = parseWebTriage(text);
  if (!base) return null;

  let visibilityGaps = "";
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const o = JSON.parse(match[0]) as Record<string, unknown>;
      if (typeof o.visibilityGaps === "string") visibilityGaps = o.visibilityGaps.trim();
    } catch {
      // The triage parser already succeeded on this text, so a failure here is
      // not possible in practice - and an absent gap note is not worth losing
      // an otherwise good re-analysis over.
    }
  }
  return { ...base, visibilityGaps };
}
