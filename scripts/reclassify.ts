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
 * Two upgrades, both conservative:
 *  - a vulnerability advisory (title reads as one) sitting in "other" with a
 *    real CVE already extracted into its IOCs moves to "exploit" (the CVE only
 *    lived in the article body, so the classifier never saw it); and
 *  - an "other" / "breach" row whose text matches a named catalogue actor moves
 *    to "research" (the actor cards).
 *
 * It never demotes research, never moves an unattributed breach, and preserves
 * any attribution already stored, so operator edits are safe.
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
  const { sortGroups, matchGroup, computeAdversaryLabel, isVulnAdvisory } =
    await import("@/lib/ingest/enrich/rules");
  const { NEXUS_COUNTRY } = await import("@/lib/actor-classify");
  const POC_RE = /\b(proof.?of.?concept|\bpoc\b|exploit code|proof-of-concept)\b/i;

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

  // CVEs already extracted (from article bodies) and linked to these items, so a
  // vulnerability advisory can be graduated to the Exploits section on its real
  // CVE even though the CVE never appeared in the title/description.
  const ids = (rows ?? []).map((r) => r.id);
  const cvesById = new Map<string, string[]>();
  // Small batches: many UUIDs in a GET .in() filter would overflow the URI.
  for (let i = 0; i < ids.length; i += 100) {
    const { data: links, error } = await db
      .from("intel_item_iocs")
      .select("intel_item_id, iocs!inner(value, ioc_type)")
      .in("intel_item_id", ids.slice(i, i + 100))
      .eq("iocs.ioc_type", "cve");
    if (error) console.error("  ! ioc lookup failed:", error.message);
    for (const l of links ?? []) {
      const value = (l.iocs as { value: string } | null)?.value;
      if (!value) continue;
      const arr = cvesById.get(l.intel_item_id);
      if (arr) arr.push(value);
      else cvesById.set(l.intel_item_id, [value]);
    }
  }
  // Newest CVE first, so the representative id is the freshest.
  const primaryCve = (id: string): string | null => {
    const list = cvesById.get(id);
    if (!list || !list.length) return null;
    return [...list].sort((a, b) => b.localeCompare(a))[0].toUpperCase();
  };

  let moved = 0;
  let promoted = 0;
  const from: Record<string, number> = {};
  for (const r of rows ?? []) {
    const unattributed =
      !r.motivation &&
      !r.crowdstrike_adversary &&
      !(r.adversary_label && !/^unid\b/i.test(r.adversary_label));

    // Vulnerability advisory with a real CVE -> the Exploits section.
    const cve = primaryCve(r.id);
    if (r.kind === "other" && unattributed && isVulnAdvisory(r.title) && cve) {
      promoted++;
      console.log(
        `${apply ? "move" : "would move"} other -> exploit [${cve}]: ${r.title.slice(0, 62)}`,
      );
      if (apply) {
        const { error } = await db
          .from("intel_items")
          .update({
            kind: "exploit",
            item_type: "vuln",
            cve_id: cve,
            target: r.title.slice(0, 200),
            exploit_status: POC_RE.test(`${r.title} ${r.description ?? ""}`)
              ? "poc"
              : "confirmed",
            confidence: null,
          })
          .eq("id", r.id);
        if (error) console.error(`  ! failed: ${error.message}`);
      }
      continue;
    }

    // Two safe signals that an item is a named actor's activity:
    //  1. it is already attributed (stored motivation / adversary), or
    //  2. the actor is named in the *title* (the subject) - high precision,
    //     unlike a body mention in a weekly digest that lists many crews.
    const alreadyAttributed = !unattributed;
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
    `\n${apply ? "Re-filed" : "Would re-file"} ${(rows ?? []).length} candidates: ` +
      `${promoted} -> exploit, ${moved} -> research` +
      (moved ? ` (research from ${Object.entries(from).map(([k, n]) => `${k}: ${n}`).join(", ")}).` : "."),
  );
  if (!apply && (moved || promoted))
    console.log("Dry run - re-run with --apply to write the changes.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
