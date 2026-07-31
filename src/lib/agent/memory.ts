import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { toAscii } from "@/lib/text";

export type Db = SupabaseClient<Database>;

export type MemoryKind = "adversary" | "trend";

/** One note in the analyst's memory. */
export type MemoryNote = {
  kind: MemoryKind;
  subject: string;
  content: string;
  mentions: number;
  lastSeen: string;
};

/** An upsert the agent proposes after reflecting on a run's reports. */
export type MemoryUpdate = {
  kind: MemoryKind;
  subject: string;
  content: string;
};

// Keep the brief small: it is injected into every triage call, so it must stay
// cheap. These caps bound the token cost regardless of how large memory grows.
const BRIEF_ADVERSARIES = 16;
const BRIEF_TRENDS = 6;
const BRIEF_MAX_CHARS = 2000;

/** Read all memory notes, most recently-seen first. */
export async function readMemory(db: Db): Promise<MemoryNote[]> {
  const { data } = await db
    .from("analyst_memory")
    .select("kind, subject, content, mentions, last_seen")
    .order("last_seen", { ascending: false });
  return (data ?? []).map((r) => ({
    kind: r.kind as MemoryKind,
    subject: r.subject,
    content: r.content,
    mentions: r.mentions,
    lastSeen: r.last_seen,
  }));
}

/**
 * Choose the notes worth putting in the brief: the most salient adversaries and
 * trends. Input is expected most-recent-first; ties break toward more mentions.
 */
export function selectBriefNotes(notes: MemoryNote[]): {
  adversaries: MemoryNote[];
  trends: MemoryNote[];
} {
  const rank = (a: MemoryNote, b: MemoryNote) =>
    b.lastSeen.localeCompare(a.lastSeen) || b.mentions - a.mentions;
  const adversaries = notes
    .filter((n) => n.kind === "adversary")
    .sort(rank)
    .slice(0, BRIEF_ADVERSARIES);
  const trends = notes
    .filter((n) => n.kind === "trend")
    .sort(rank)
    .slice(0, BRIEF_TRENDS);
  return { adversaries, trends };
}

/**
 * Compose the compact, ASCII memory brief injected into the agent's prompts.
 * Empty string when there is nothing to say yet (a cold start), so callers can
 * drop it in unconditionally.
 */
export function composeBrief(notes: MemoryNote[]): string {
  const { adversaries, trends } = selectBriefNotes(notes);
  if (adversaries.length === 0 && trends.length === 0) return "";
  const lines: string[] = [];
  if (adversaries.length) {
    lines.push("Known adversaries:");
    for (const a of adversaries) lines.push(`- ${a.subject}: ${a.content}`);
  }
  if (trends.length) {
    lines.push("Tracked trends:");
    for (const t of trends) lines.push(`- ${t.subject}: ${t.content}`);
  }
  return toAscii(lines.join("\n"), true).slice(0, BRIEF_MAX_CHARS);
}

/** Read memory and compose the brief in one step. */
export async function loadMemoryBrief(db: Db): Promise<string> {
  return composeBrief(await readMemory(db));
}

/**
 * Apply the agent's proposed updates: upsert each note by (kind, subject),
 * replacing its content, bumping `mentions`, and refreshing `last_seen`. New
 * subjects are inserted. Invalid entries are skipped.
 */
export async function upsertMemoryNotes(
  db: Db,
  updates: MemoryUpdate[],
): Promise<number> {
  let written = 0;
  const nowIso = new Date().toISOString();
  for (const u of updates) {
    const subject = u.subject?.trim();
    const content = toAscii((u.content ?? "").trim(), true).slice(0, 1000);
    if (!subject || !content) continue;
    if (u.kind !== "adversary" && u.kind !== "trend") continue;

    const existing = await db
      .from("analyst_memory")
      .select("id, mentions")
      .eq("kind", u.kind)
      .ilike("subject", subject)
      .maybeSingle();
    if (existing.data) {
      const { error } = await db
        .from("analyst_memory")
        .update({
          content,
          mentions: existing.data.mentions + 1,
          last_seen: nowIso,
        })
        .eq("id", existing.data.id);
      if (!error) written++;
    } else {
      const { error } = await db
        .from("analyst_memory")
        .insert({ kind: u.kind, subject, content, last_seen: nowIso });
      if (!error) written++;
    }
  }
  return written;
}

/**
 * Parse the agent's reflection output (strict JSON, tolerant of surrounding
 * prose) into memory updates. Returns [] on anything malformed.
 */
export function parseReflection(text: string): MemoryUpdate[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (typeof raw !== "object" || raw === null) return [];
  const o = raw as Record<string, unknown>;
  const out: MemoryUpdate[] = [];
  const take = (arr: unknown, kind: MemoryKind) => {
    if (!Array.isArray(arr)) return;
    for (const e of arr) {
      if (typeof e !== "object" || e === null) continue;
      const r = e as Record<string, unknown>;
      const subject = typeof r.subject === "string" ? r.subject : "";
      const content = typeof r.content === "string" ? r.content : "";
      if (subject && content) out.push({ kind, subject, content });
    }
  };
  take(o.adversaries, "adversary");
  take(o.trends, "trend");
  return out;
}
