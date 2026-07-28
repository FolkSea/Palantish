// Pure parsing for LLM-inferred MITRE ATT&CK techniques. Client-safe (no
// server-only imports) so the type can be shared with the modal and unit-tested.
import { toAscii } from "@/lib/text";

export type DiscoveredTechnique = { code: string; name: string };

// Technique id (T1059) or sub-technique (T1059.003).
const CODE_RE = /^T\d{4}(?:\.\d{3})?$/;

/**
 * Parse the model's reply into a deduped list of {code, name}. Tolerant of
 * surrounding prose: extracts the first JSON array and keeps only well-formed
 * technique codes. Never throws.
 */
export function parseTechniques(raw: string): DiscoveredTechnique[] {
  const match = (raw ?? "").match(/\[[\s\S]*\]/);
  if (!match) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];

  const seen = new Set<string>();
  const out: DiscoveredTechnique[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const code =
      typeof o.code === "string" ? o.code.toUpperCase().trim() : "";
    if (!CODE_RE.test(code) || seen.has(code)) continue;
    const name = typeof o.name === "string" ? toAscii(o.name).trim() : "";
    seen.add(code);
    out.push({ code, name: name || code });
  }
  return out;
}
