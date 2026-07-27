import { createHash } from "node:crypto";
import type { RawCandidate } from "./types";

/** Normalise a string for stable hashing (trim, collapse ws, lower-case). */
function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Deterministic dedup key from title + url. Two feed entries that share both a
 * title and a url collapse to one row, regardless of whitespace or casing.
 */
export function computeHash(title: string, url: string): string {
  return createHash("sha256")
    .update(`${normalize(title)}|${normalize(url)}`)
    .digest("hex");
}

/**
 * Given candidates and the set of hashes already stored, return only the unseen
 * ones, each tagged with its hash. Also de-duplicates within the batch itself.
 */
export function selectNewCandidates(
  candidates: RawCandidate[],
  existingHashes: ReadonlySet<string>,
): Array<RawCandidate & { rawHash: string }> {
  const seen = new Set<string>(existingHashes);
  const out: Array<RawCandidate & { rawHash: string }> = [];
  for (const c of candidates) {
    const rawHash = computeHash(c.title, c.url);
    if (seen.has(rawHash)) continue;
    seen.add(rawHash);
    out.push({ ...c, rawHash });
  }
  return out;
}
