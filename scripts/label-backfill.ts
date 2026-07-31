/**
 * Backfill taxonomy labels onto already-stored reports by re-running the triage
 * agent over them - for items ingested before labelling existed, or after a
 * flatten/reingest that ran without the LLM. Applies the same AI/Malware/
 * Adversary/Target labels the live pipeline would, and records them to memory.
 *
 *   pnpm label-backfill                          # local dev (.env.local), dry run
 *   pnpm label-backfill --apply                  # write labels
 *   pnpm label-backfill --apply --limit 200      # cap items processed
 *   pnpm label-backfill --all                    # include already-labelled items
 *   pnpm label-backfill <url> <service_role_key> # target a project directly
 *
 * Each item is one LLM (triage) call. Dry run triages only a small sample to
 * show example output and reports how many items would be processed. Requires
 * ANTHROPIC_API_KEY (or the agent has nothing to call).
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const all = args.includes("--all");
const limitArg = args.find((a) => a.startsWith("--limit"));
const limit = limitArg
  ? Number(limitArg.split("=")[1] ?? args[args.indexOf(limitArg) + 1])
  : 0; // 0 = no cap
const positional = args.filter((a) => !a.startsWith("--") && !/^\d+$/.test(a));
const [argUrl, argKey] = positional;

let SUPABASE_URL = argUrl || process.env.NEXT_PUBLIC_SUPABASE_URL;
let SERVICE_ROLE_KEY = argKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  config({ path: ".env.local" });
  SUPABASE_URL = SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  SERVICE_ROLE_KEY = SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (t: T, i: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(
      "Missing Supabase target. Pass <url> <service_role_key> or set " +
        "NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.",
    );
    process.exit(1);
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      "ANTHROPIC_API_KEY is not set - the triage agent cannot run. Set it and retry.",
    );
    process.exit(1);
  }

  const db = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { AnalystAgent } = await import("@/lib/agent/analyst");
  const { loadMemoryBrief, recordLabels } = await import("@/lib/agent/memory");
  const { linkLabelsToItem } = await import("@/lib/ingest/labels");

  // Skip already-labelled items unless --all.
  const skip = new Set<string>();
  if (!all) {
    const { data } = await db
      .from("intel_item_labels")
      .select("intel_item_id");
    for (const r of data ?? []) skip.add(r.intel_item_id);
  }

  // Source categories sharpen the triage prompt.
  const { data: sources } = await db.from("sources").select("name, category");
  const categoryByName = new Map(
    (sources ?? []).map((s) => [s.name, s.category ?? null]),
  );

  // Page through all items (PostgREST caps a page at 1000).
  type Row = {
    id: string;
    title: string;
    description: string | null;
    url: string | null;
    source_name: string | null;
    published_at: string | null;
  };
  const items: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("intel_items")
      .select("id, title, description, url, source_name, published_at")
      .order("created_at", { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    items.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  let todo = items.filter((i) => !skip.has(i.id));
  if (limit > 0) todo = todo.slice(0, limit);

  console.log(
    `${items.length} reports total; ${skip.size} already labelled; ` +
      `${todo.length} to process${limit > 0 ? ` (limited to ${limit})` : ""}.`,
  );
  if (todo.length === 0) return;

  const agent = new AnalystAgent(apiKey, await loadMemoryBrief(db));
  const labelsUsed = new Set<string>();
  let processed = 0;
  let linked = 0;
  let withLabels = 0;

  // Dry run: sample a few to show example labels without triaging everything.
  const batch = apply ? todo : todo.slice(0, Math.min(8, todo.length));
  if (!apply)
    console.log(
      `\nDry run: triaging a ${batch.length}-item sample (of ${todo.length}) to preview labels.\n`,
    );

  await mapPool(batch, 4, async (item) => {
    try {
      const r = await agent.triage({
        title: item.title,
        description: item.description,
        url: item.url ?? "",
        publishedAt: item.published_at ? new Date(item.published_at) : new Date(),
        sourceName: item.source_name ?? "",
        sourceCategory: categoryByName.get(item.source_name ?? "") ?? null,
      });
      const labels = r?.labels ?? [];
      processed++;
      if (labels.length) {
        withLabels++;
        for (const l of labels) labelsUsed.add(l);
        if (apply) linked += await linkLabelsToItem(db, item.id, labels);
        else console.log(`  ${item.title.slice(0, 60)}\n    -> ${labels.join(", ")}`);
      }
      if (apply && processed % 25 === 0)
        console.log(`  ...${processed}/${batch.length} processed`);
    } catch (err) {
      console.error(`  ! ${item.id}: ${err instanceof Error ? err.message : err}`);
    }
  });

  console.log(
    `\nProcessed ${processed}; ${withLabels} got labels; ` +
      `${labelsUsed.size} distinct labels${apply ? `; ${linked} links written` : ""}.`,
  );
  if (!apply) {
    console.log(
      `Distinct labels in sample: ${[...labelsUsed].sort().join(", ") || "(none)"}`,
    );
    console.log(`\nDry run - re-run with --apply to label all ${todo.length} items.`);
    return;
  }
  if (labelsUsed.size) {
    const n = await recordLabels(db, [...labelsUsed]);
    console.log(`Recorded ${n} labels to analyst memory.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
