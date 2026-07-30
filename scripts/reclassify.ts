/**
 * Re-file already-stored intel_items against the current adversary catalogue.
 *
 *   pnpm reclassify                          # local dev (uses .env.local)
 *   pnpm reclassify <url> <service_role_key> # target a project directly
 *   pnpm reclassify --apply                  # write changes (default is a dry run)
 *
 * Why this exists: an item's `kind` (which dashboard section it lands in) is set
 * once, at ingest. Feed re-pulls skip items already stored (dedup), so when the
 * catalogue gains an actor, items ingested earlier that name that actor stay in
 * "Other reporting" instead of moving to the eCrime / hacktivism / nation-state
 * sections. This pass re-runs attribution over stored rows and moves the ones
 * whose classification changed.
 *
 * Conservative by design: it only *upgrades* "other" and "breach" rows into
 * "research" when the text matches a named catalogue actor (that item is the
 * actor's activity, so it belongs in the actor cards). It never demotes research,
 * never touches exploits, never moves an unattributed breach, and preserves any
 * attribution already stored, so operator edits are safe.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const positional = args.filter((a) => !a.startsWith("--"));
const [argUrl, argKey] = positional;

let SUPABASE_URL = argUrl || process.env.NEXT_PUBLIC_SUPABASE_URL;
let SERVICE_ROLE_KEY = argKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  config({ path: ".env.local" });
  SUPABASE_URL = SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  SERVICE_ROLE_KEY = SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(
      "Missing Supabase target. Pass them as args:\n" +
        "  pnpm reclassify <url> <service_role_key>\n" +
        "or set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.",
    );
    process.exit(1);
  }

  const { buildGroupsFromAdversaries } = await import("@/lib/ingest/adversaries");
  const { sortGroups, matchGroup, computeAdversaryLabel } = await import(
    "@/lib/ingest/enrich/rules"
  );
  const { NEXUS_COUNTRY } = await import("@/lib/actor-classify");

  const db = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: adversaries, error: advErr } = await db
    .from("adversaries")
    .select("name, nexus, country, motivation, community_identifiers, internal_alternative_names");
  if (advErr) {
    console.error("Could not read adversaries:", advErr.message);
    process.exit(1);
  }
  const groups = sortGroups(buildGroupsFromAdversaries(adversaries ?? []));
  const advByName = new Map(
    (adversaries ?? []).map((a) => [
      (a.name ?? "").toLowerCase(),
      { motivation: a.motivation?.[0] ?? null, country: a.country ?? null },
    ]),
  );

  // "other" and "breach" rows are candidates: a named-actor match upgrades them
  // to research (the actor cards). Exploits and existing research are left alone.
  const { data: rows, error: rowsErr } = await db
    .from("intel_items")
    .select(
      "id, title, description, kind, motivation, country, crowdstrike_adversary, adversary_label",
    )
    .in("kind", ["other", "breach"]);
  if (rowsErr) {
    console.error("Could not read intel_items:", rowsErr.message);
    process.exit(1);
  }

  let moved = 0;
  const from: Record<string, number> = {};
  for (const r of rows ?? []) {
    // Two safe signals that an item is a named actor's activity:
    //  1. it is already attributed (stored motivation / adversary), or
    //  2. the actor is named in the *title* (the subject) - high precision,
    //     unlike a body mention in a weekly digest that lists many crews.
    const alreadyAttributed =
      !!r.motivation ||
      !!r.crowdstrike_adversary ||
      (!!r.adversary_label && !/^unid\b/i.test(r.adversary_label));
    const titleGroup = matchGroup(r.title.toLowerCase(), groups);
    if (!alreadyAttributed && !titleGroup) continue;

    // Start from whatever attribution is stored; fill gaps from the title match
    // when the item was not previously attributed.
    let motivation = r.motivation;
    let country = r.country;
    let crowdstrike_adversary = r.crowdstrike_adversary;
    let adversary_label = r.adversary_label;
    if (!alreadyAttributed && titleGroup) {
      const adv = titleGroup.cs ? advByName.get(titleGroup.cs.toLowerCase()) : undefined;
      if (adv?.motivation) {
        motivation = adv.motivation;
        country = country ?? adv.country;
      } else if (titleGroup.nexus && titleGroup.nexus !== "other") {
        motivation = "nation_state";
        country = country ?? (NEXUS_COUNTRY[titleGroup.nexus] ?? null);
      }
      crowdstrike_adversary = titleGroup.cs ?? null;
      adversary_label = computeAdversaryLabel(
        titleGroup.cs ?? null,
        titleGroup.nexus ?? null,
        r.title,
        r.description,
        groups,
      );
    }

    from[r.kind] = (from[r.kind] ?? 0) + 1;
    moved++;
    console.log(
      `${apply ? "move" : "would move"} ${r.kind} -> research [${adversary_label}]: ${r.title.slice(0, 66)}`,
    );
    if (apply) {
      const { error } = await db
        .from("intel_items")
        .update({ kind: "research", motivation, country, crowdstrike_adversary, adversary_label })
        .eq("id", r.id);
      if (error) console.error(`  ! failed: ${error.message}`);
    }
  }

  console.log(
    `\n${apply ? "Re-filed" : "Would re-file"} ${moved} of ${(rows ?? []).length} candidate items into research` +
      (moved ? ` (from ${Object.entries(from).map(([k, n]) => `${k}: ${n}`).join(", ")}).` : "."),
  );
  if (!apply && moved)
    console.log("Dry run - re-run with --apply to write the changes.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
