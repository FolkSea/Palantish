"use server";

import { revalidatePath, unstable_noStore as noStore } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ingestArticle,
  importBlogPostWithAI,
  importPastedPost,
  type ImportResult,
} from "@/lib/ingest/import-post";
import {
  scrapeArticle,
  assertPublicHttpUrl,
  fetchArticleView,
} from "@/lib/ingest/scrape";
import { isThreatIntel } from "@/lib/relevance";
import {
  normalizeIndicator,
  validIndicator,
  normalizeIndicatorValue,
  type Indicators,
} from "@/lib/report-indicators";
import { indicatorRows, linkIocsToItem, type IocRow } from "@/lib/ingest/iocs";
import { familyForAnimal } from "@/lib/ingest/adversaries";
import { discoverTechniques } from "@/lib/mitre/discover";
import type { DiscoveredTechnique } from "@/lib/mitre/parse";

async function ensureAllowed(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "Not authorized.";
  return null;
}

function refreshDashboard() {
  // Refresh the dashboard (and settings source list) without touching the
  // cached executive summary.
  revalidatePath("/");
  revalidatePath("/settings");
}

export type ItemMutationResult = { ok: boolean; error?: string };

/**
 * Permanently delete an intel item from the database and add its content hash
 * to the blocklist so the ingest pipeline never re-imports it. Global (affects
 * every viewer), auth-checked.
 */
export async function deleteItemAction(
  rawHash: string,
): Promise<ItemMutationResult> {
  if (!rawHash) return { ok: false, error: "Missing item reference." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Not authorized." };
  }

  const db = createAdminClient();

  // The item lives in one of three tables (intel_items / breaches /
  // vulnerabilities); capture url + a title for the audit record, then remove
  // it wherever it is. raw_hash is unique across tables.
  let url: string | null = null;
  let title: string | null = null;
  const intel = await db
    .from("intel_items")
    .select("url, title")
    .eq("raw_hash", rawHash)
    .maybeSingle();
  if (intel.data) {
    url = intel.data.url;
    title = intel.data.title;
  } else {
    const breach = await db
      .from("breaches")
      .select("url, org_name")
      .eq("raw_hash", rawHash)
      .maybeSingle();
    if (breach.data) {
      url = breach.data.url;
      title = breach.data.org_name;
    } else {
      const vuln = await db
        .from("vulnerabilities")
        .select("url, cve_id")
        .eq("raw_hash", rawHash)
        .maybeSingle();
      if (vuln.data) {
        url = vuln.data.url;
        title = vuln.data.cve_id;
      }
    }
  }

  const del1 = await db.from("intel_items").delete().eq("raw_hash", rawHash);
  const del2 = await db.from("breaches").delete().eq("raw_hash", rawHash);
  const del3 = await db.from("vulnerabilities").delete().eq("raw_hash", rawHash);
  const delErr = del1.error ?? del2.error ?? del3.error;
  if (delErr) return { ok: false, error: delErr.message };

  const { error: blockErr } = await db.from("deleted_items").upsert(
    { raw_hash: rawHash, url, title, deleted_by: user.id },
    { onConflict: "raw_hash", ignoreDuplicates: true },
  );
  if (blockErr) return { ok: false, error: blockErr.message };

  revalidatePath("/");
  return { ok: true };
}

/**
 * Hide an item for the current user only. Persisted per-user; RLS ensures the
 * row is scoped to the authenticated user.
 */
export async function hideItemAction(
  rawHash: string,
): Promise<ItemMutationResult> {
  if (!rawHash) return { ok: false, error: "Missing item reference." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Not authorized." };
  }

  const { error } = await supabase.from("hidden_items").upsert(
    { user_id: user.id, raw_hash: rawHash },
    { onConflict: "user_id,raw_hash", ignoreDuplicates: true },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/** Unhide an item the current user previously hid (per-user; RLS-scoped). */
export async function unhideItemAction(
  rawHash: string,
): Promise<ItemMutationResult> {
  if (!rawHash) return { ok: false, error: "Missing item reference." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Not authorized." };
  }

  const { error } = await supabase
    .from("hidden_items")
    .delete()
    .eq("user_id", user.id)
    .eq("raw_hash", rawHash);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Default import: heuristic scrape then ingest. If the scrape/extraction fails,
 * the result is marked `recoverable` so the UI can offer the AI or paste
 * fallback. URL-validation and "already imported" failures are not recoverable.
 */
export async function importPostAction(url: string): Promise<ImportResult> {
  if (!url || !url.trim()) return { ok: false, error: "Enter a URL to import." };
  const unauth = await ensureAllowed();
  if (unauth) return { ok: false, error: unauth };

  try {
    assertPublicHttpUrl(url.trim());
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid URL." };
  }

  let article;
  try {
    article = await scrapeArticle(url.trim());
  } catch (err) {
    // Fetch / extraction failure: offer AI or paste.
    return {
      ok: false,
      recoverable: true,
      error: err instanceof Error ? err.message : "Could not read that page.",
    };
  }

  const result = await ingestArticle(article);
  if (result.ok) refreshDashboard();
  return result;
}

/** Fallback import: read the page with the LLM, then ingest. */
export async function importPostWithAIAction(url: string): Promise<ImportResult> {
  if (!url || !url.trim()) return { ok: false, error: "Enter a URL to import." };
  const unauth = await ensureAllowed();
  if (unauth) return { ok: false, error: unauth };
  try {
    assertPublicHttpUrl(url.trim());
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid URL." };
  }

  let result: ImportResult;
  try {
    result = await importBlogPostWithAI(url.trim());
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "AI could not read that page.",
    };
  }
  if (result.ok) refreshDashboard();
  return result;
}

/** Fallback import: ingest a pasted title + body. */
export async function importPostManualAction(
  url: string,
  title: string,
  body: string,
): Promise<ImportResult> {
  if (!url || !url.trim()) return { ok: false, error: "Enter a URL to import." };
  if (!title || !title.trim()) return { ok: false, error: "A title is required." };
  const unauth = await ensureAllowed();
  if (unauth) return { ok: false, error: unauth };
  try {
    assertPublicHttpUrl(url.trim());
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid URL." };
  }

  let result: ImportResult;
  try {
    result = await importPastedPost(url.trim(), title, body);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Import failed.",
    };
  }
  if (result.ok) refreshDashboard();
  return result;
}

/* --- Report view ----------------------------------------------------------- */

export type ReportViewResult =
  | { ok: true; frameable: boolean; html: string; text: string }
  | { ok: false; error: string };

/**
 * Fetch a report URL server-side (as a browser) and tell the details modal how
 * to show it: `frameable` reports whether the page's framing headers permit
 * embedding the live URL; `html` is a sandboxed snapshot to render via `srcdoc`
 * when they do not; and `text` is the scraped article body as a final fallback.
 */
export async function fetchReportViewAction(
  url: string,
): Promise<ReportViewResult> {
  if (!url || !url.trim()) return { ok: false, error: "No report URL." };
  const unauth = await ensureAllowed();
  if (unauth) return { ok: false, error: unauth };
  try {
    assertPublicHttpUrl(url.trim());
    const { frameable, html, text } = await fetchArticleView(url.trim());
    return { ok: true, frameable, html, text };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not fetch the report.",
    };
  }
}

/* --- Persist report indicators --------------------------------------------- */

/**
 * Upsert a report's extracted IOCs (deduped by value) and link them to the
 * report via the intel_item_iocs join table, so indicators become searchable.
 * Values are stored in their original (non-defanged) form. Idempotent; existing
 * IOC comments are preserved. Called opportunistically when a report is viewed.
 */
export async function persistReportIndicatorsAction(
  rawHash: string,
  indicators: Indicators,
): Promise<{ ok: boolean; linked?: number; error?: string }> {
  if (!rawHash) return { ok: false, error: "Missing item reference." };
  const unauth = await ensureAllowed();
  if (unauth) return { ok: false, error: unauth };

  const rows = indicatorRows(indicators);
  if (rows.length === 0) return { ok: true, linked: 0 };

  return linkReportIocs(rawHash, rows);
}

/**
 * Look up an intel item by raw_hash and link the given IOC rows to it. Shared by
 * indicator persistence and MITRE discovery.
 */
async function linkReportIocs(
  rawHash: string,
  rows: IocRow[],
): Promise<{ ok: boolean; linked?: number; error?: string }> {
  const db = createAdminClient();

  const item = await db
    .from("intel_items")
    .select("id")
    .eq("raw_hash", rawHash)
    .maybeSingle();
  if (!item.data) return { ok: false, error: "Report not found." };

  try {
    const linked = await linkIocsToItem(db, item.data.id, rows);
    return { ok: true, linked };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Link failed." };
  }
}

/**
 * Read a report's stored indicators (IOCs + MITRE codes) from the database,
 * grouped by type. Empty arrays when the report has none yet, so the modal can
 * fall back to on-the-fly extraction. MITRE codes are returned in `mitre`.
 */
export async function getReportIndicatorsAction(
  rawHash: string,
): Promise<
  // `kind` says whether the rawHash is an intel report or a breach - both are
  // attributable, but IOCs/country/confidence only apply to intel reports.
  | { ok: true; indicators: Indicators; kind: "intel" | "breach" | null }
  | { ok: false; error: string }
> {
  const empty: Indicators = {
    ips: [],
    domains: [],
    uris: [],
    files: [],
    cves: [],
    mitre: [],
  };
  if (!rawHash) return { ok: true, indicators: empty, kind: null };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Not authorized." };
  }

  const item = await supabase
    .from("intel_items")
    .select("id")
    .eq("raw_hash", rawHash)
    .maybeSingle();
  if (!item.data) {
    const breach = await supabase
      .from("breaches")
      .select("id")
      .eq("raw_hash", rawHash)
      .maybeSingle();
    return {
      ok: true,
      indicators: empty,
      kind: breach.data ? "breach" : null,
    };
  }

  const links = await supabase
    .from("intel_item_iocs")
    .select("ioc_id")
    .eq("intel_item_id", item.data.id);
  const iocIds = (links.data ?? []).map((r) => r.ioc_id);
  if (iocIds.length === 0)
    return { ok: true, indicators: empty, kind: "intel" };

  const iocsRes = await supabase
    .from("iocs")
    .select("value, ioc_type")
    .in("id", iocIds);
  if (iocsRes.error) return { ok: false, error: iocsRes.error.message };

  const grouped: Indicators = {
    ips: [],
    domains: [],
    uris: [],
    files: [],
    cves: [],
    mitre: [],
  };
  for (const ioc of iocsRes.data ?? []) {
    if (ioc.ioc_type === "ip") grouped.ips.push(ioc.value);
    else if (ioc.ioc_type === "domain") grouped.domains.push(ioc.value);
    else if (ioc.ioc_type === "uri") grouped.uris.push(ioc.value);
    else if (ioc.ioc_type === "file_hash") grouped.files.push(ioc.value);
    else if (ioc.ioc_type === "cve") grouped.cves.push(ioc.value);
    else if (ioc.ioc_type === "mitre") grouped.mitre.push(ioc.value);
  }
  return { ok: true, indicators: grouped, kind: "intel" };
}

/** Delete an ioc's link to a report (and the ioc row if it becomes orphaned),
 * so an operator can remove an indicator scraped by mistake. */
export async function deleteReportIocAction(
  rawHash: string,
  value: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!rawHash || !value) return { ok: false, error: "Missing input." };
  const unauth = await ensureAllowed();
  if (unauth) return { ok: false, error: unauth };

  const db = createAdminClient();
  const item = await db
    .from("intel_items")
    .select("id")
    .eq("raw_hash", rawHash)
    .maybeSingle();
  if (!item.data) return { ok: false, error: "Report not found." };

  const ioc = await db.from("iocs").select("id").eq("value", value).maybeSingle();
  if (!ioc.data) return { ok: true }; // already gone

  const unlink = await db
    .from("intel_item_iocs")
    .delete()
    .eq("intel_item_id", item.data.id)
    .eq("ioc_id", ioc.data.id);
  if (unlink.error) return { ok: false, error: unlink.error.message };

  const { count } = await db
    .from("intel_item_iocs")
    .select("ioc_id", { count: "exact", head: true })
    .eq("ioc_id", ioc.data.id);
  if ((count ?? 0) === 0) await db.from("iocs").delete().eq("id", ioc.data.id);

  return { ok: true };
}

/** Replace an ioc value on a report: validate the new value, unlink the old one
 * (dropping it if orphaned) and link the corrected value. The deduped iocs table
 * is preserved, so edits never affect other reports sharing the old value. */
export async function updateReportIocAction(
  rawHash: string,
  oldValue: string,
  newValue: string,
  iocType: string,
): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  if (!rawHash) return { ok: false, error: "Missing report." };
  const unauth = await ensureAllowed();
  if (unauth) return { ok: false, error: unauth };
  if (!validIndicator(newValue, iocType)) {
    return { ok: false, error: `Not a valid ${iocType.replace("_", " ")}.` };
  }
  const normalized = normalizeIndicatorValue(newValue, iocType);

  const db = createAdminClient();
  // Editing an indicator on a breach reclassifies it into a report first.
  const ensured = await ensureReportItem(db, rawHash);
  if ("error" in ensured) return { ok: false, error: ensured.error };
  const intelItemId = ensured.id;

  if (normalized !== oldValue) {
    const oldIoc = await db
      .from("iocs")
      .select("id")
      .eq("value", oldValue)
      .maybeSingle();
    if (oldIoc.data) {
      await db
        .from("intel_item_iocs")
        .delete()
        .eq("intel_item_id", intelItemId)
        .eq("ioc_id", oldIoc.data.id);
      const { count } = await db
        .from("intel_item_iocs")
        .select("ioc_id", { count: "exact", head: true })
        .eq("ioc_id", oldIoc.data.id);
      if ((count ?? 0) === 0) await db.from("iocs").delete().eq("id", oldIoc.data.id);
    }
  }

  try {
    await linkIocsToItem(db, intelItemId, [{ value: normalized, ioc_type: iocType }]);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Update failed." };
  }
  return { ok: true, value: normalized };
}

/* --- Report attribution (adversary) --------------------------------------- */

const UNID_FAMILY_OPTIONS = [
  "PANDA",
  "BEAR",
  "CHOLLIMA",
  "KITTEN",
  "TIGER",
  "WOLF",
  "BUFFALO",
  "LEOPARD",
  "BAT",
  "SPIDER",
  "JACKAL",
].map((a) => `UNID ${a}`);

const FAMILY_COUNTRIES = [
  "China",
  "Russia",
  "North Korea",
  "Iran",
  "India",
  "Turkey",
  "Vietnam",
  "Pakistan",
];

/** Autocomplete options for the modal's Attribution + Country inputs. */
export async function getAttributionOptionsAction(): Promise<{
  adversaries: string[];
  countries: string[];
}> {
  // Never cache: suggestions must reflect the current actors table, so edits in
  // Settings show up the next time the modal is opened.
  noStore();
  const unauth = await ensureAllowed();
  if (unauth) return { adversaries: [], countries: [] };
  const db = createAdminClient();
  const { data } = await db.from("adversaries").select("name, country");
  const names = [
    ...new Set((data ?? []).map((a) => a.name).filter(Boolean) as string[]),
  ].sort((a, b) => a.localeCompare(b));
  const countries = [
    ...new Set([
      ...FAMILY_COUNTRIES,
      ...((data ?? []).map((a) => a.country).filter(Boolean) as string[]),
    ]),
  ].sort((a, b) => a.localeCompare(b));
  return { adversaries: [...UNID_FAMILY_OPTIONS, ...names], countries };
}

export type UpdateAdversaryResult =
  | {
      ok: true;
      label: string;
      matched: boolean;
      country: string | null;
      regrouped: boolean;
      // false when the entered text is neither a catalogue adversary/alias nor a
      // UNID <family> - the UI prompts to add it and nothing is written yet.
      recognised: boolean;
      // true when this edit reclassified a breach into a report.
      moved: boolean;
    }
  | { ok: false; error: string };

type AdminDb = ReturnType<typeof createAdminClient>;

/**
 * Resolve a rawHash to an intel_items report id. When it is currently a breach,
 * convert it into a report (carrying its fields + any stored attribution) and
 * delete the breach row - attributing a breach moves it into the reports table
 * so it can be edited exactly like any other report. `moved` reports whether a
 * conversion happened.
 */
async function ensureReportItem(
  db: AdminDb,
  rawHash: string,
): Promise<{ id: string; moved: boolean } | { error: string }> {
  const item = await db
    .from("intel_items")
    .select("id")
    .eq("raw_hash", rawHash)
    .maybeSingle();
  if (item.data) return { id: item.data.id, moved: false };

  const { data: b } = await db
    .from("breaches")
    .select("*")
    .eq("raw_hash", rawHash)
    .maybeSingle();
  if (!b) return { error: "Report not found." };

  const { data: inserted, error } = await db
    .from("intel_items")
    .insert({
      raw_hash: b.raw_hash,
      title: b.org_name,
      description: b.summary,
      url: b.url,
      published_at: b.event_date ?? new Date().toISOString().slice(0, 10),
      item_type: "report",
      source_name: b.source_name,
      source_id: b.source_id,
      confidence: "medium",
      adversary_label: b.adversary_label,
      crowdstrike_adversary: b.crowdstrike_adversary,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    return { error: error?.message ?? "Could not move the breach to reports." };
  }
  await db.from("breaches").delete().eq("id", b.id);
  return { id: inserted.id, moved: true };
}

/**
 * Set a report's attributed adversary. If the entered text matches a catalogue
 * adversary's name or one of its aliases, it is resolved to the preferred
 * (CrowdStrike) name and the report's country + motivation are updated to that
 * adversary's - so the item regroups under the correct country card. Free text
 * that matches nothing is kept as the label as-is.
 */
export async function updateReportAdversaryAction(
  rawHash: string,
  input: string,
): Promise<UpdateAdversaryResult> {
  if (!rawHash) return { ok: false, error: "Missing report." };
  const unauth = await ensureAllowed();
  if (unauth) return { ok: false, error: unauth };
  const raw = input.trim();

  const db = createAdminClient();

  // Resolve the entered name/alias to a catalogue adversary (preferred name).
  const needle = raw.toLowerCase();
  let matched: {
    name: string;
    country: string | null;
    motivation: string[] | null;
  } | null = null;
  if (raw) {
    const { data: advs } = await db
      .from("adversaries")
      .select("name, country, motivation, community_identifiers, internal_alternative_names");
    matched =
      (advs ?? []).find((a) => {
        if ((a.name ?? "").toLowerCase() === needle) return true;
        const aliases = [
          ...(a.community_identifiers ?? []),
          ...(a.internal_alternative_names ?? []),
        ];
        return aliases.some((x) => (x ?? "").toLowerCase() === needle);
      }) ?? null;
  }

  // A generic "UNID <FAMILY>" (or a bare family) carries its own classification,
  // so re-derive country + motivation from it - otherwise the item would keep
  // the previous country and not move (e.g. back to Non Attributed for BAT).
  const family = matched
    ? null
    : familyForAnimal(/^(?:unid\s+)?([a-z]+)$/i.exec(raw)?.[1] ?? "");

  // Unrecognised free text: prompt to add it to the catalogue; write nothing
  // and do not reclassify a breach yet.
  if (raw && !matched && !family) {
    return {
      ok: true,
      label: raw,
      matched: false,
      country: null,
      regrouped: false,
      recognised: false,
      moved: false,
    };
  }

  // Clearing the attribution is an un-attribution, not a reclassification: leave
  // a breach as a breach (just drop its stored label).
  if (!raw) {
    const intel = await db
      .from("intel_items")
      .select("id")
      .eq("raw_hash", rawHash)
      .maybeSingle();
    if (intel.data) {
      const { error } = await db
        .from("intel_items")
        .update({ adversary_label: null, crowdstrike_adversary: null })
        .eq("id", intel.data.id);
      if (error) return { ok: false, error: error.message };
    } else {
      const br = await db
        .from("breaches")
        .select("id")
        .eq("raw_hash", rawHash)
        .maybeSingle();
      if (!br.data) return { ok: false, error: "Report not found." };
      const { error } = await db
        .from("breaches")
        .update({ adversary_label: null, crowdstrike_adversary: null })
        .eq("id", br.data.id);
      if (error) return { ok: false, error: error.message };
    }
    revalidatePath("/");
    return {
      ok: true,
      label: "",
      matched: false,
      country: null,
      regrouped: false,
      recognised: true,
      moved: false,
    };
  }

  // Recognised attribution: ensure a report row (converting a breach), then set
  // the actor + its country/motivation so it groups under the right card.
  const ensured = await ensureReportItem(db, rawHash);
  if ("error" in ensured) return { ok: false, error: ensured.error };

  let label: string;
  let country: string | null;
  let update: {
    adversary_label: string | null;
    crowdstrike_adversary: string | null;
    country: string | null;
    motivation: string | null;
  };
  if (matched) {
    label = matched.name;
    country = matched.country ?? null;
    update = {
      adversary_label: matched.name,
      crowdstrike_adversary: matched.name,
      country: matched.country,
      motivation: matched.motivation?.[0] ?? null,
    };
  } else {
    label = raw.toUpperCase();
    country = family!.country;
    update = {
      adversary_label: label,
      crowdstrike_adversary: null,
      country: family!.country,
      motivation: family!.motivation,
    };
  }

  const { error } = await db
    .from("intel_items")
    .update(update)
    .eq("id", ensured.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return {
    ok: true,
    label,
    matched: !!matched,
    country,
    regrouped: true,
    recognised: true,
    moved: ensured.moved,
  };
}

/**
 * Manually set a report's country (for cases with no family mapping, e.g. a
 * researcher's own actor name). A non-empty country also marks the item as
 * nation-state so it groups under that country's card; clearing it moves the
 * item to Non Attributed.
 */
export async function updateReportCountryAction(
  rawHash: string,
  country: string,
): Promise<
  | { ok: true; country: string | null; moved: boolean }
  | { ok: false; error: string }
> {
  if (!rawHash) return { ok: false, error: "Missing report." };
  const unauth = await ensureAllowed();
  if (unauth) return { ok: false, error: unauth };
  const c = country.trim();

  const db = createAdminClient();

  // Clearing the country is only meaningful on an existing report; a breach has
  // no country, so leave it as a breach.
  if (!c) {
    const intel = await db
      .from("intel_items")
      .select("id")
      .eq("raw_hash", rawHash)
      .maybeSingle();
    if (intel.data) {
      const { error } = await db
        .from("intel_items")
        .update({ country: null })
        .eq("id", intel.data.id);
      if (error) return { ok: false, error: error.message };
      revalidatePath("/");
    }
    return { ok: true, country: null, moved: false };
  }

  // Setting a country is a nation-state attribution: ensure a report row
  // (converting a breach) and group it under that country.
  const ensured = await ensureReportItem(db, rawHash);
  if ("error" in ensured) return { ok: false, error: ensured.error };
  const { error } = await db
    .from("intel_items")
    .update({ country: c, motivation: "nation_state" })
    .eq("id", ensured.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true, country: c, moved: ensured.moved };
}

const CONFIDENCE_VALUES = ["high", "medium", "low"];

/** Set a report's attribution confidence (high / medium / low). */
export async function updateReportConfidenceAction(
  rawHash: string,
  confidence: string,
): Promise<
  | { ok: true; confidence: string | null; moved: boolean }
  | { ok: false; error: string }
> {
  if (!rawHash) return { ok: false, error: "Missing report." };
  const unauth = await ensureAllowed();
  if (unauth) return { ok: false, error: unauth };
  const c = confidence.trim().toLowerCase();
  if (c && !CONFIDENCE_VALUES.includes(c))
    return { ok: false, error: "Invalid confidence." };

  const db = createAdminClient();
  const ensured = await ensureReportItem(db, rawHash);
  if ("error" in ensured) return { ok: false, error: ensured.error };

  const { error } = await db
    .from("intel_items")
    .update({ confidence: c || null })
    .eq("id", ensured.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true, confidence: c || null, moved: ensured.moved };
}

/* --- MITRE ATT&CK discovery ------------------------------------------------ */

export type DiscoverTechniquesResult =
  | { ok: true; techniques: DiscoveredTechnique[] }
  | { ok: false; error: string };

/**
 * Use the LLM to infer the MITRE ATT&CK techniques a report describes, then
 * store the technique codes as IOCs (ioc_type 'mitre') linked to the report so
 * they are searchable like any other indicator. Returns code + name for display.
 */
export async function discoverTechniquesAction(
  rawHash: string | null,
  text: string,
): Promise<DiscoverTechniquesResult> {
  const unauth = await ensureAllowed();
  if (unauth) return { ok: false, error: unauth };
  if (!text || !text.trim()) {
    return { ok: false, error: "No report text to analyse yet." };
  }

  let techniques: DiscoveredTechnique[];
  try {
    techniques = await discoverTechniques(text);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Technique discovery failed.",
    };
  }

  if (rawHash && techniques.length) {
    const rows: IocRow[] = techniques.map((t) => ({
      value: t.code,
      ioc_type: "mitre",
    }));
    await linkReportIocs(rawHash, rows); // best-effort; display is unaffected
  }

  return { ok: true, techniques };
}

/* --- Search ---------------------------------------------------------------- */

export type SearchReport = {
  id: string;
  title: string;
  url: string | null;
  description: string | null;
  source_name: string | null;
  published_at: string | null;
  raw_hash: string;
};
export type SearchBreach = {
  id: string;
  org_name: string;
  url: string | null;
  summary: string | null;
  source_name: string | null;
  event_date: string | null;
  event_date_label: string | null;
};
export type SearchVuln = {
  id: string;
  cve_id: string;
  target: string | null;
  url: string | null;
  detail: string | null;
  status: "confirmed" | "suspected" | "poc";
  source_name: string | null;
};
export type SearchResults = {
  query: string;
  reports: SearchReport[];
  breaches: SearchBreach[];
  vulns: SearchVuln[];
};

const SEARCH_LIMIT = 50;

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type IntelSearchRow = {
  id: string;
  title: string;
  url: string | null;
  description: string | null;
  source_name: string | null;
  published_at: string | null;
  raw_hash: string;
};

/**
 * Find reports linked to an IOC whose value matches the query. The query is
 * normalised to the stored (non-defanged) form first, so `evil[.]com`,
 * `hxxps://evil.com` and `evil.com` all resolve to the same indicator.
 */
async function reportsByIndicator(
  supabase: SupabaseServerClient,
  query: string,
): Promise<IntelSearchRow[]> {
  const value = normalizeIndicator(query);
  if (value.length < 3) return [];

  // ilike without wildcards is a case-insensitive exact match on the value.
  const iocRes = await supabase.from("iocs").select("id").ilike("value", value);
  const iocIds = (iocRes.data ?? []).map((r) => r.id);
  if (iocIds.length === 0) return [];

  const linkRes = await supabase
    .from("intel_item_iocs")
    .select("intel_item_id")
    .in("ioc_id", iocIds);
  const itemIds = [...new Set((linkRes.data ?? []).map((r) => r.intel_item_id))];
  if (itemIds.length === 0) return [];

  const itemsRes = await supabase
    .from("intel_items")
    .select("id, title, url, description, source_name, published_at, raw_hash")
    .in("id", itemIds)
    .order("published_at", { ascending: false })
    .limit(SEARCH_LIMIT);
  return itemsRes.data ?? [];
}

/**
 * Search intel items, breaches, and vulnerabilities by keyword and return the
 * matches grouped by section. Also matches reports by a linked indicator value
 * (fanged or defanged). Honours the same relevance filter and per-user hidden
 * list as the dashboard; deleted items are already gone from the DB.
 */
export async function searchDashboard(query: string): Promise<SearchResults> {
  const q = (query ?? "").trim();
  const empty: SearchResults = { query: q, reports: [], breaches: [], vulns: [] };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return empty;

  // Strip characters significant to PostgREST's or()/ilike grammar so the query
  // is a safe literal substring match.
  const safe = q.replace(/[,()%_\\*]/g, " ").replace(/\s+/g, " ").trim();
  if (safe.length < 2) return empty;
  const like = `%${safe}%`;

  const [intelRes, breachRes, vulnRes, hiddenRes] = await Promise.all([
    supabase
      .from("intel_items")
      .select("id, title, url, description, source_name, published_at, raw_hash")
      .or(`title.ilike.${like},description.ilike.${like}`)
      .order("published_at", { ascending: false })
      .limit(SEARCH_LIMIT),
    supabase
      .from("breaches")
      .select(
        "id, org_name, url, summary, source_name, event_date, event_date_label, raw_hash",
      )
      .or(`org_name.ilike.${like},summary.ilike.${like}`)
      .order("event_date", { ascending: false })
      .limit(SEARCH_LIMIT),
    supabase
      .from("vulnerabilities")
      .select("id, cve_id, target, url, detail, status, source_name, raw_hash")
      .or(`cve_id.ilike.${like},target.ilike.${like},detail.ilike.${like}`)
      .order("added_at", { ascending: false })
      .limit(SEARCH_LIMIT),
    supabase.from("hidden_items").select("raw_hash"),
  ]);

  const hidden = new Set((hiddenRes.data ?? []).map((r) => r.raw_hash));

  // Indicator match: normalise the query (so it matches whether typed fanged or
  // defanged) and pull any reports linked to an IOC with that exact value.
  const indicatorItems = await reportsByIndicator(supabase, q);

  const reportById = new Map<string, SearchReport>();
  const addReports = (
    rows: {
      id: string;
      title: string;
      url: string | null;
      description: string | null;
      source_name: string | null;
      published_at: string | null;
      raw_hash: string;
    }[],
    requireRelevance: boolean,
  ) => {
    for (const r of rows) {
      if (hidden.has(r.raw_hash)) continue;
      if (requireRelevance && !isThreatIntel(r.title, r.description)) continue;
      if (reportById.has(r.id)) continue;
      reportById.set(r.id, {
        id: r.id,
        title: r.title,
        url: r.url,
        description: r.description,
        source_name: r.source_name,
        published_at: r.published_at,
        raw_hash: r.raw_hash,
      });
    }
  };
  // Indicator hits are shown even if the relevance heuristic would drop them -
  // an explicit IOC search is a strong signal of intent.
  addReports(indicatorItems, false);
  addReports(intelRes.data ?? [], true);
  const reports: SearchReport[] = [...reportById.values()];
  const breaches: SearchBreach[] = (breachRes.data ?? [])
    .filter((b) => !hidden.has(b.raw_hash) && isThreatIntel(b.org_name, b.summary))
    .map((b) => ({
      id: b.id,
      org_name: b.org_name,
      url: b.url,
      summary: b.summary,
      source_name: b.source_name,
      event_date: b.event_date,
      event_date_label: b.event_date_label,
    }));
  const vulns: SearchVuln[] = (vulnRes.data ?? [])
    .filter((v) => !hidden.has(v.raw_hash))
    .map((v) => ({
      id: v.id,
      cve_id: v.cve_id,
      target: v.target,
      url: v.url,
      detail: v.detail,
      status: v.status,
      source_name: v.source_name,
    }));

  return { query: q, reports, breaches, vulns };
}
