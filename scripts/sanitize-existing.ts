/**
 * One-off: rewrite already-stored feed text to plain ASCII (decode HTML
 * entities, transliterate smart punctuation). Recomputes raw_hash from the
 * sanitized text so future ingests still dedup correctly. `pnpm sanitize`.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { toAscii } = await import("@/lib/text");
  const { computeHash } = await import("@/lib/ingest/dedup");

  const db = createAdminClient();
  const changed = { intel_items: 0, breaches: 0, vulnerabilities: 0, summaries: 0 };

  // intel_items: title + description; raw_hash from sanitized title + url.
  const { data: intel } = await db
    .from("intel_items")
    .select("id, title, description, url, raw_hash");
  for (const r of intel ?? []) {
    const title = toAscii(r.title);
    const description = r.description ? toAscii(r.description) : r.description;
    const raw_hash = computeHash(title, r.url ?? "");
    if (title === r.title && description === r.description && raw_hash === r.raw_hash)
      continue;
    const { error } = await db
      .from("intel_items")
      .update({ title, description, raw_hash })
      .eq("id", r.id);
    if (!error) changed.intel_items++;
    else console.error("intel_items", r.id, error.message);
  }

  // breaches: org_name + summary; raw_hash from sanitized org_name + url.
  const { data: breaches } = await db
    .from("breaches")
    .select("id, org_name, summary, url, raw_hash");
  for (const r of breaches ?? []) {
    const org_name = toAscii(r.org_name);
    const summary = r.summary ? toAscii(r.summary) : r.summary;
    const raw_hash = computeHash(org_name, r.url ?? "");
    if (org_name === r.org_name && summary === r.summary && raw_hash === r.raw_hash)
      continue;
    const { error } = await db
      .from("breaches")
      .update({ org_name, summary, raw_hash })
      .eq("id", r.id);
    if (!error) changed.breaches++;
    else console.error("breaches", r.id, error.message);
  }

  // vulnerabilities: target + detail; raw_hash from sanitized target + url.
  const { data: vulns } = await db
    .from("vulnerabilities")
    .select("id, target, detail, url, raw_hash");
  for (const r of vulns ?? []) {
    const target = r.target ? toAscii(r.target) : r.target;
    const detail = r.detail ? toAscii(r.detail) : r.detail;
    const raw_hash = computeHash(target ?? "", r.url ?? "");
    if (target === r.target && detail === r.detail && raw_hash === r.raw_hash)
      continue;
    const { error } = await db
      .from("vulnerabilities")
      .update({ target, detail, raw_hash })
      .eq("id", r.id);
    if (!error) changed.vulnerabilities++;
    else console.error("vulnerabilities", r.id, error.message);
  }

  // executive_summaries: preserve paragraph breaks.
  const { data: summaries } = await db
    .from("executive_summaries")
    .select("id, summary");
  for (const r of summaries ?? []) {
    const summary = toAscii(r.summary, true);
    if (summary === r.summary) continue;
    const { error } = await db
      .from("executive_summaries")
      .update({ summary })
      .eq("id", r.id);
    if (!error) changed.summaries++;
    else console.error("executive_summaries", r.id, error.message);
  }

  console.log(JSON.stringify(changed, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
