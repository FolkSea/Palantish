"use server";

import { ANIMAL_COUNTRY } from "@/lib/badges";
import { revalidatePath, unstable_noStore as noStore } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ensureAuthenticated,
  getAdministratorClient,
  getAuthenticatedClient,
} from "@/lib/auth";
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
import { parseQuery, fieldsUsed } from "@/lib/search/query";
import { evaluateQuery } from "@/lib/search/evaluate";
import { loadSearchCorpus } from "@/lib/search/corpus";
import { loadLabelsFor } from "@/lib/report-labels";
import { queueNotifications } from "@/lib/notify/queue";
import {
  validIndicator,
  normalizeIndicatorValue,
  type Indicators,
} from "@/lib/report-indicators";
import {
  indicatorRows,
  linkIocsToItem,
  replaceIocsForItem,
  type IocRow,
} from "@/lib/ingest/iocs";
import { AnalystAgent } from "@/lib/agent/analyst";
import { reconcileIndicators } from "@/lib/agent/ioc-validate";
import { notifyUsers } from "@/lib/notifications/create";
import { itemHref } from "@/lib/browse-links";
import { ensureCatalogueActor } from "@/lib/ingest/catalogue";
import { loadIocAllowlist } from "@/lib/ingest/allowlist";
import { familyForAnimal } from "@/lib/ingest/adversaries";
import { discoverTechniques } from "@/lib/mitre/discover";
import type { DiscoveredTechnique } from "@/lib/mitre/parse";

function refreshDashboard() {
  // Refresh the dashboard (and settings source list) without touching the
  // cached executive summary.
  revalidatePath("/");
  revalidatePath("/settings");
}

export type ItemMutationResult = { ok: boolean; error?: string };

/**
 * Permanently delete an intel item from the database and add its content hash
 * to the blocklist so the ingest pipeline never re-imports it.
 *
 * Administrators only. This is the one destructive action here that is global
 * and irreversible: the row goes, and the hash is blocklisted so no later
 * ingest can bring it back. Editing a report, or removing one of its
 * indicators, is collaborative work any analyst may do; erasing the report for
 * everyone is not. Note the gate has to live here rather than in RLS - the
 * write runs as the service role, which no policy constrains.
 */
export async function deleteItemAction(
  rawHash: string,
): Promise<ItemMutationResult> {
  if (!rawHash) return { ok: false, error: "Missing item reference." };
  const auth = await getAdministratorClient();
  if (!auth) {
    return { ok: false, error: "Administrator access required." };
  }
  const { user } = auth;

  const db = createAdminClient();

  // Every report lives in intel_items now. Capture url + title for the audit
  // record, then remove it.
  const intel = await db
    .from("intel_items")
    .select("url, title")
    .eq("raw_hash", rawHash)
    .maybeSingle();
  const url = intel.data?.url ?? null;
  const title = intel.data?.title ?? null;

  const del = await db.from("intel_items").delete().eq("raw_hash", rawHash);
  if (del.error) return { ok: false, error: del.error.message };

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
  const auth = await getAuthenticatedClient();
  if (!auth) {
    return { ok: false, error: "Not authorized." };
  }
  const { supabase, user } = auth;

  const { error } = await supabase.from("hidden_items").upsert(
    { user_id: user.id, raw_hash: rawHash },
    { onConflict: "user_id,raw_hash", ignoreDuplicates: true },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

export async function unhideItemAction(
  rawHash: string,
): Promise<ItemMutationResult> {
  if (!rawHash) return { ok: false, error: "Missing item reference." };
  const auth = await getAuthenticatedClient();
  if (!auth) {
    return { ok: false, error: "Not authorized." };
  }
  const { supabase, user } = auth;

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
  const unauth = await ensureAuthenticated();
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

export async function importPostWithAIAction(url: string): Promise<ImportResult> {
  if (!url || !url.trim()) return { ok: false, error: "Enter a URL to import." };
  const unauth = await ensureAuthenticated();
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

export async function importPostManualAction(
  url: string,
  title: string,
  body: string,
): Promise<ImportResult> {
  if (!url || !url.trim()) return { ok: false, error: "Enter a URL to import." };
  if (!title || !title.trim()) return { ok: false, error: "A title is required." };
  const unauth = await ensureAuthenticated();
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

export type ReportViewResult =
  | {
      ok: true;
      frameable: boolean;
      html: string;
      text: string;
      markdown: string;
    }
  | { ok: false; error: string };

/**
 * Fetch a report URL server-side (as a browser) and tell the details view how to
 * show it: `markdown` is the clean reading view it renders by default; for the
 * "original page" toggle, `frameable` reports whether the page's framing headers
 * permit embedding the live URL and `html` is a sandboxed snapshot to render via
 * `srcdoc` when they do not; and `text` is the plain article body, which drives
 * IOC extraction.
 */
export async function fetchReportViewAction(
  url: string,
): Promise<ReportViewResult> {
  if (!url || !url.trim()) return { ok: false, error: "No report URL." };
  const unauth = await ensureAuthenticated();
  if (unauth) return { ok: false, error: unauth };
  try {
    assertPublicHttpUrl(url.trim());
    const { frameable, html, text, markdown } = await fetchArticleView(url.trim());
    return { ok: true, frameable, html, text, markdown };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not fetch the report.",
    };
  }
}

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
  const unauth = await ensureAuthenticated();
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
export type ReportNotes = {
  analystComments: string | null;
  visibilityGaps: string | null;
};

/** The stored attribution for a report, so the modal shows it regardless of how
 * it was opened (a card passes it in the prop; the summary / search do not). */
export type ReportAttribution = {
  adversary: string | null;
  country: string | null;
  confidence: string | null;
};

export async function getReportIndicatorsAction(
  rawHash: string,
): Promise<
  // `kind` is "intel" when the rawHash resolves to a report (all reports are
  // intel_items rows now, and every one is editable), null when it does not.
  | {
      ok: true;
      indicators: Indicators;
      kind: "intel" | null;
      notes: ReportNotes;
      labels: string[];
      attribution: ReportAttribution;
      // The IOC allowlist, so the modal's fallback extraction (for reports with
      // no stored IOCs) drops the same vendor domains / noise IPs as ingest.
      allowlist: { domains: string[]; ips: string[] };
    }
  | { ok: false; error: string }
> {
  const empty: Indicators = {
    ips: [],
    domains: [],
    files: [],
    cves: [],
    mitre: [],
  };
  const noNotes: ReportNotes = { analystComments: null, visibilityGaps: null };
  const noAttr: ReportAttribution = {
    adversary: null,
    country: null,
    confidence: null,
  };
  const noAllow = { domains: [], ips: [] };
  if (!rawHash)
    return {
      ok: true,
      indicators: empty,
      kind: null,
      notes: noNotes,
      labels: [],
      attribution: noAttr,
      allowlist: noAllow,
    };

  const auth = await getAuthenticatedClient();
  if (!auth) {
    return { ok: false, error: "Not authorized." };
  }
  const { supabase } = auth;
  const allowlist = await loadIocAllowlist(supabase);

  const item = await supabase
    .from("intel_items")
    .select(
      "id, analyst_comments, visibility_gaps, adversary_label, crowdstrike_adversary, country, confidence",
    )
    .eq("raw_hash", rawHash)
    .maybeSingle();
  if (!item.data)
    return {
      ok: true,
      indicators: empty,
      kind: null,
      notes: noNotes,
      labels: [],
      attribution: noAttr,
      allowlist,
    };
  const notes: ReportNotes = {
    analystComments: item.data.analyst_comments,
    visibilityGaps: item.data.visibility_gaps,
  };
  const attribution: ReportAttribution = {
    adversary: item.data.adversary_label ?? item.data.crowdstrike_adversary ?? null,
    country: item.data.country,
    confidence: item.data.confidence,
  };

  // User-defined labels linked to this report (deduped, alphabetical).
  const labelLinks = await supabase
    .from("intel_item_labels")
    .select("label_id")
    .eq("intel_item_id", item.data.id);
  const labelIds = (labelLinks.data ?? []).map((r) => r.label_id);
  let labels: string[] = [];
  if (labelIds.length) {
    const lr = await supabase
      .from("labels")
      .select("name")
      .in("id", labelIds)
      .order("name");
    labels = (lr.data ?? []).map((r) => r.name);
  }

  const links = await supabase
    .from("intel_item_iocs")
    .select("ioc_id")
    .eq("intel_item_id", item.data.id);
  const iocIds = (links.data ?? []).map((r) => r.ioc_id);
  if (iocIds.length === 0)
    return { ok: true, indicators: empty, kind: "intel", notes, labels, attribution, allowlist };

  const iocsRes = await supabase
    .from("iocs")
    .select("value, ioc_type")
    .in("id", iocIds);
  if (iocsRes.error) return { ok: false, error: iocsRes.error.message };

  const grouped: Indicators = {
    ips: [],
    domains: [],
    files: [],
    cves: [],
    mitre: [],
  };
  for (const ioc of iocsRes.data ?? []) {
    if (ioc.ioc_type === "ip") grouped.ips.push(ioc.value);
    else if (ioc.ioc_type === "domain") grouped.domains.push(ioc.value);
    // uri rows predate the type being retired; they are neither read nor shown.
    else if (ioc.ioc_type === "file_hash") grouped.files.push(ioc.value);
    else if (ioc.ioc_type === "cve") grouped.cves.push(ioc.value);
    else if (ioc.ioc_type === "mitre") grouped.mitre.push(ioc.value);
  }
  return { ok: true, indicators: grouped, kind: "intel", notes, labels, attribution, allowlist };
}

/**
 * Delete an ioc's link to a report (and the ioc row if it becomes orphaned), so
 * an operator can remove an indicator scraped by mistake.
 *
 * Open to any analyst, deliberately. Correcting a bad indicator on the report
 * in front of you is ordinary collaborative work, and the mistakes here are the
 * kind anyone reading a report will spot. Note this is a weaker gate than
 * removeFlaggedIndicators in settings/review-actions, which is administrator
 * only: that one acts on the corpus in bulk from a review queue and also
 * allow-lists the value against future ingests, which is a standing decision
 * rather than a correction. Both are intentional; do not "make them
 * consistent" without deciding which workflow you mean.
 */
export async function deleteReportIocAction(
  rawHash: string,
  value: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!rawHash || !value) return { ok: false, error: "Missing input." };
  const unauth = await ensureAuthenticated();
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
  const unauth = await ensureAuthenticated();
  if (unauth) return { ok: false, error: unauth };
  if (!validIndicator(newValue, iocType)) {
    return { ok: false, error: `Not a valid ${iocType.replace("_", " ")}.` };
  }
  const normalized = normalizeIndicatorValue(newValue, iocType);

  const db = createAdminClient();
  const item = await resolveReport(db, rawHash);
  if (!item) return { ok: false, error: "Report not found." };
  const intelItemId = item.id;

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

// Both derived from the one family list, so a family the app can produce is
// always a family the editor offers back. CRANE was previously missing from
// both, which made "UNID CRANE" - a label the app generates itself - read as
// unrecognised free text.
const UNID_FAMILY_OPTIONS = Object.keys(ANIMAL_COUNTRY).map((a) => `UNID ${a}`);

const FAMILY_COUNTRIES = Object.values(ANIMAL_COUNTRY).filter(
  (c): c is string => c !== null,
);

export async function getAttributionOptionsAction(): Promise<{
  adversaries: string[];
  countries: string[];
}> {
  // Never cache: suggestions must reflect the current actors table, so edits in
  // Settings show up the next time the modal is opened.
  noStore();
  const unauth = await ensureAuthenticated();
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

async function resolveReport(
  db: AdminDb,
  rawHash: string,
): Promise<{ id: string; kind: string | null } | null> {
  const { data } = await db
    .from("intel_items")
    .select("id, kind")
    .eq("raw_hash", rawHash)
    .maybeSingle();
  return data ? { id: data.id, kind: data.kind } : null;
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
  const unauth = await ensureAuthenticated();
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

  const item = await resolveReport(db, rawHash);
  if (!item) return { ok: false, error: "Report not found." };

  // Clearing the attribution is an un-attribution, not a reclassification: drop
  // the stored label but leave the item's kind unchanged.
  if (!raw) {
    const { error } = await db
      .from("intel_items")
      .update({ adversary_label: null, crowdstrike_adversary: null })
      .eq("id", item.id);
    if (error) return { ok: false, error: error.message };
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

  // Recognised attribution: set the actor + its country/motivation, and flag the
  // item as research so it groups under the right actor card - except exploits,
  // which stay in the Exploits section even when attributed.
  const newKind = item.kind === "exploit" ? "exploit" : "research";
  let label: string;
  let country: string | null;
  let update: {
    adversary_label: string | null;
    crowdstrike_adversary: string | null;
    country: string | null;
    motivation: string | null;
    kind: string;
  };
  if (matched) {
    label = matched.name;
    country = matched.country ?? null;
    update = {
      adversary_label: matched.name,
      crowdstrike_adversary: matched.name,
      country: matched.country,
      motivation: matched.motivation?.[0] ?? null,
      kind: newKind,
    };
  } else {
    label = raw.toUpperCase();
    country = family!.country;
    update = {
      adversary_label: label,
      crowdstrike_adversary: null,
      country: family!.country,
      motivation: family!.motivation,
      kind: newKind,
    };
  }

  const { error } = await db
    .from("intel_items")
    .update(update)
    .eq("id", item.id);
  if (error) return { ok: false, error: error.message };
  await queueNotifications(db, [item.id], "attribution");
  revalidatePath("/");
  return {
    ok: true,
    label,
    matched: !!matched,
    country,
    regrouped: true,
    recognised: true,
    moved: item.kind !== newKind,
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
  const unauth = await ensureAuthenticated();
  if (unauth) return { ok: false, error: unauth };
  const c = country.trim();

  const db = createAdminClient();

  // Clearing the country is only meaningful on an existing report; a breach has
  // no country, so leave it as a breach.
  if (!c) {
    const item = await resolveReport(db, rawHash);
    if (item) {
      const { error } = await db
        .from("intel_items")
        .update({ country: null })
        .eq("id", item.id);
      if (error) return { ok: false, error: error.message };
      revalidatePath("/");
    }
    return { ok: true, country: null, moved: false };
  }

  // Setting a country is a nation-state attribution: group it under that country
  // and flag it as research - except exploits, which stay in the Exploits list.
  const item = await resolveReport(db, rawHash);
  if (!item) return { ok: false, error: "Report not found." };
  const newKind = item.kind === "exploit" ? "exploit" : "research";
  const { error } = await db
    .from("intel_items")
    .update({ country: c, motivation: "nation_state", kind: newKind })
    .eq("id", item.id);
  if (error) return { ok: false, error: error.message };
  await queueNotifications(db, [item.id], "attribution");
  revalidatePath("/");
  return { ok: true, country: c, moved: item.kind !== newKind };
}

const CONFIDENCE_VALUES = ["high", "medium", "low"];

export async function updateReportConfidenceAction(
  rawHash: string,
  confidence: string,
): Promise<
  | { ok: true; confidence: string | null; moved: boolean }
  | { ok: false; error: string }
> {
  if (!rawHash) return { ok: false, error: "Missing report." };
  const unauth = await ensureAuthenticated();
  if (unauth) return { ok: false, error: unauth };
  const c = confidence.trim().toLowerCase();
  if (c && !CONFIDENCE_VALUES.includes(c))
    return { ok: false, error: "Invalid confidence." };

  const db = createAdminClient();
  const item = await resolveReport(db, rawHash);
  if (!item) return { ok: false, error: "Report not found." };

  const { error } = await db
    .from("intel_items")
    .update({ confidence: c || null })
    .eq("id", item.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true, confidence: c || null, moved: false };
}

export async function updateReportNoteAction(
  rawHash: string,
  field: "analyst_comments" | "visibility_gaps",
  value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!rawHash) return { ok: false, error: "Missing report." };
  if (field !== "analyst_comments" && field !== "visibility_gaps")
    return { ok: false, error: "Invalid field." };
  const unauth = await ensureAuthenticated();
  if (unauth) return { ok: false, error: unauth };

  const db = createAdminClient();
  const item = await resolveReport(db, rawHash);
  if (!item) return { ok: false, error: "Report not found." };

  const v = value.trim() || null;
  const update =
    field === "analyst_comments"
      ? { analyst_comments: v }
      : { visibility_gaps: v };
  const { error } = await db
    .from("intel_items")
    .update(update)
    .eq("id", item.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true };
}

/**
 * Replace a report's user-defined labels with the comma-separated set entered in
 * the modal. Each label is trimmed and deduped case-insensitively; new labels
 * are added to the shared `labels` table (find-or-create) and linked to the
 * report, and links no longer present are removed. Returns the stored labels.
 */
export async function updateReportLabelsAction(
  rawHash: string,
  input: string,
): Promise<{ ok: true; labels: string[] } | { ok: false; error: string }> {
  if (!rawHash) return { ok: false, error: "Missing report." };
  const unauth = await ensureAuthenticated();
  if (unauth) return { ok: false, error: unauth };

  const db = createAdminClient();
  const item = await resolveReport(db, rawHash);
  if (!item) return { ok: false, error: "Report not found." };

  // Parse the comma-separated field: trim, drop empties, dedup case-insensitively
  // while keeping the first spelling seen.
  const seen = new Map<string, string>();
  for (const raw of input.split(",")) {
    const name = raw.trim().replace(/\s+/g, " ");
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  const names = [...seen.values()];

  const error = await replaceReportLabels(db, item.id, names);
  if (error) return { ok: false, error };

  // The report may now match a label someone subscribes to. Queued only - the
  // digest goes out with the next run, so saving labels stays instant.
  await queueNotifications(db, [item.id], "labels");
  revalidatePath("/");
  return { ok: true, labels: names.sort((a, b) => a.localeCompare(b)) };
}

/**
 * Make a report's labels exactly `names`: find-or-create each one and drop the
 * links that are no longer in the set. Returns an error message, or null.
 *
 * Replace rather than add, because this is what the editor and the re-analysis
 * both mean by setting labels - a label removed has to actually go.
 */
async function replaceReportLabels(
  db: AdminDb,
  itemId: string,
  names: string[],
): Promise<string | null> {
  const labelIds: string[] = [];
  for (const name of names) {
    const existing = await db
      .from("labels")
      .select("id")
      .ilike("name", name)
      .maybeSingle();
    if (existing.data) {
      labelIds.push(existing.data.id);
      continue;
    }
    const inserted = await db
      .from("labels")
      .insert({ name })
      .select("id")
      .single();
    if (inserted.error) {
      // A concurrent insert may have won the unique(lower(name)) race; re-read.
      const again = await db
        .from("labels")
        .select("id")
        .ilike("name", name)
        .maybeSingle();
      if (again.data) labelIds.push(again.data.id);
      else return inserted.error.message;
    } else {
      labelIds.push(inserted.data.id);
    }
  }

  const del = await db
    .from("intel_item_labels")
    .delete()
    .eq("intel_item_id", itemId);
  if (del.error) return del.error.message;
  if (labelIds.length) {
    const ins = await db.from("intel_item_labels").insert(
      labelIds.map((label_id) => ({ intel_item_id: itemId, label_id })),
    );
    if (ins.error) return ins.error.message;
  }
  return null;
}

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
  const unauth = await ensureAuthenticated();
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

export type AiRefreshResult =
  | {
      ok: true;
      summary: string;
      labels: string[];
      visibilityGaps: string;
      indicators: Indicators;
      /** The actor written, "" when the model named none, null when the name
       *  could not be an actor at all (nothing was written). */
      adversary: string | null;
      /** True when that actor was new and has just entered the catalogue. */
      actorAdded: boolean;
      country: string | null;
      confidence: string | null;
    }
  | { ok: false; error: string };

/**
 * Re-read one report with the LLM and replace what is stored about it: summary,
 * labels, attribution, visibility gaps and indicators.
 *
 * Ingest classifies a report once, from whatever the fetch returned at the time,
 * and raw_hash dedupe means nothing ever revisits it - a report that arrived
 * while the model was slow keeps its untagged, unattributed record for good.
 * This is the way to ask for that second look.
 *
 * Indicators are replaced, not added to, so they are held to a higher bar than
 * at ingest: only what the model judged to be attacker infrastructure, each
 * value still checked against the fetched page. Nothing is written at all if the
 * re-read fails - a half-read record is worse than the stale one.
 *
 * Notifies the analyst who pressed the button either way. It is a long call and
 * they will have gone elsewhere by the time it lands.
 */
export async function aiRefreshReportAction(
  rawHash: string,
): Promise<AiRefreshResult> {
  if (!rawHash) return { ok: false, error: "Missing report." };
  const auth = await getAuthenticatedClient();
  if (!auth) return { ok: false, error: "Not authorized." };

  const db = createAdminClient();
  const { data: item } = await db
    .from("intel_items")
    .select("id, title, url, description, source_name, published_at")
    .eq("raw_hash", rawHash)
    .maybeSingle();
  if (!item) return { ok: false, error: "Report not found." };

  const notify = async (title: string, body: string) => {
    try {
      await notifyUsers(db, [auth.user.id], {
        kind: "report_reanalysed",
        title,
        body,
        href: itemHref(rawHash),
        // One notification per attempt: a second run is a second event, and the
        // analyst asked for it and is owed the answer.
        dedupeKey: `reanalyse:${rawHash}:${Date.now()}`,
      });
    } catch {
      // Never fail the re-analysis over its own receipt.
    }
  };

  const fail = async (error: string): Promise<AiRefreshResult> => {
    await notify(`Re-analysis failed: ${item.title}`, error);
    return { ok: false, error };
  };

  if (!item.url) return fail("This report has no link to re-read.");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail("No ANTHROPIC_API_KEY is configured.");

  const agent = new AnalystAgent(apiKey);
  const out = await agent.reanalyse({
    title: item.title,
    url: item.url,
    description: item.description,
    publishedAt: item.published_at ? new Date(item.published_at) : null,
    sourceName: item.source_name ?? "",
    sourceCategory: null,
  });
  if (!out.parsed) return fail(out.error ?? "The re-analysis produced nothing.");
  const p = out.parsed;

  // Indicators: the model's own, validated against the page it read. The
  // deterministic sweep the ingest unions in is deliberately off - it reads the
  // whole page, and here its false positives would replace curated values.
  const allowlist = await loadIocAllowlist(db);
  const own = (() => {
    try {
      return new URL(item.url!).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  })();
  const rows = reconcileIndicators(
    p.indicators,
    p.mitreTechniques,
    out.fetchedText,
    {
      excludeDomains: [...allowlist.domains, ...(own ? [own] : [])],
      excludeIps: allowlist.ips,
    },
    { extractFromText: false },
  );

  try {
    await replaceIocsForItem(db, item.id, rows);
  } catch (err) {
    return fail(
      err instanceof Error ? err.message : "The indicators could not be stored.",
    );
  }

  const update: { description?: string; visibility_gaps?: string } = {};
  if (p.summary) update.description = p.summary;
  if (p.visibilityGaps) update.visibility_gaps = p.visibilityGaps;
  if (Object.keys(update).length) {
    const { error } = await db.from("intel_items").update(update).eq("id", item.id);
    if (error) return fail(error.message);
  }

  const labelError = await replaceReportLabels(db, item.id, p.labels);
  if (labelError) return fail(labelError);

  // Attribution goes through the ordinary edit so the report regroups under the
  // right country the way a typed-in name does - which means the actor has to
  // exist in the catalogue first. Reporting names actors faster than anyone
  // curates them, so an unknown one is added as provisional rather than
  // dropped: an attribution to an actor the catalogue has never heard of is
  // uneditable, unmatchable, and joins up with nothing.
  let adversary: string | null = "";
  let country: string | null = null;
  let actorAdded = false;
  if (p.crowdstrikeAdversary) {
    const ensured = await ensureCatalogueActor(db, p.crowdstrikeAdversary, p.nexus);
    if (!ensured.name) {
      adversary = null; // not a name that can be an actor; attribute nothing
    } else {
      actorAdded = ensured.created;
      const res = await updateReportAdversaryAction(rawHash, ensured.name);
      adversary = res.ok && res.recognised ? res.label : null;
      country = res.ok ? res.country : null;
    }
  }

  await queueNotifications(db, [item.id], "labels");
  const indicators = indicatorsFromRows(rows);
  await notify(
    `Re-analysis complete: ${item.title}`,
    `${p.labels.length} labels, ${rows.length} indicators.` +
      (actorAdded ? ` Added ${adversary} to the actor catalogue.` : ""),
  );
  revalidatePath("/");
  return {
    ok: true,
    summary: p.summary,
    labels: p.labels.slice().sort((a, b) => a.localeCompare(b)),
    visibilityGaps: p.visibilityGaps,
    indicators,
    adversary,
    actorAdded,
    country,
    confidence: p.confidence,
  };
}

/** Group stored IOC rows back into the shape the panel renders. */
function indicatorsFromRows(rows: IocRow[]): Indicators {
  const of = (type: string) =>
    rows.filter((r) => r.ioc_type === type).map((r) => r.value);
  return {
    ips: of("ip"),
    domains: of("domain"),
    files: of("file_hash"),
    cves: of("cve"),
    mitre: of("mitre"),
  };
}

/**
 * A report as every list view renders it. One shape for search, the personal
 * feed and the browse pages, because they all present it the same way (see
 * ReportTable) - the section it lands in is the only thing that differs.
 */
export type SearchResultRow = {
  id: string;
  title: string;
  url: string | null;
  description: string | null;
  source_name: string | null;
  published_at: string | null;
  country: string | null;
  confidence: string | null;
  adversary_label: string | null;
  crowdstrike_adversary: string | null;
  raw_hash: string;
  labels: string[];
};

export type SearchResults = {
  query: string;
  reports: SearchResultRow[];
  breaches: SearchResultRow[];
  vulns: SearchResultRow[];
  /** Set when the query could not be parsed; the box shows it as written. */
  error?: string;
  /** True when more reports exist than the search corpus covered. */
  truncated: boolean;
};

const SEARCH_LIMIT = 50;

/**
 * Search the dashboard with the query language: field terms (label:, adv:, ip:,
 * dom:, cve:, ttp: ...), boolean logic, and regex via `:~`. A bare word is a
 * keyword match on the report text, and adjacent terms are an implicit AND, so
 * plain typing still works exactly as it reads.
 *
 * Honours the same per-user hidden list as the dashboard; deleted items are
 * already gone from the DB.
 */
export async function searchDashboard(query: string): Promise<SearchResults> {
  const q = (query ?? "").trim();
  const empty: SearchResults = {
    query: q,
    reports: [],
    breaches: [],
    vulns: [],
    truncated: false,
  };

  const auth = await getAuthenticatedClient();
  if (!auth) return empty;
  const supabase = auth.supabase;

  const parsed = parseQuery(q);
  if (!parsed.ok) return { ...empty, error: parsed.error };

  const { rows, docs, truncated } = await loadSearchCorpus(parsed.node);
  const matchedIds = new Set(
    evaluateQuery(parsed.node, docs).map((d) => d.id),
  );
  const matched = rows.filter((r) => matchedIds.has(r.id));

  // The relevance heuristic keeps general news out of a plain keyword search.
  // Naming a field is an explicit statement of intent, so it opts out - the
  // same exception indicator searches have always had.
  const fields = fieldsUsed(parsed.node);
  const requireRelevance = fields.size === 1 && fields.has("text");

  const pick = (kinds: string[], relevance: boolean) =>
    matched
      .filter((r) => kinds.includes(r.kind ?? ""))
      .filter((r) => !relevance || isThreatIntel(r.title, r.description))
      .slice(0, SEARCH_LIMIT);

  const reportRows = pick(["research", "other"], requireRelevance);
  const breachRows = pick(["breach"], requireRelevance);
  const vulnRows = pick(["exploit"], false);

  // Labels are only needed for what is actually shown, so this is a handful of
  // rows rather than the whole corpus.
  const labels = await loadLabelsFor(
    supabase,
    [...reportRows, ...breachRows, ...vulnRows].map((r) => r.id),
  );
  const toRow = (r: (typeof matched)[number]): SearchResultRow => ({
    id: r.id,
    title: r.title,
    url: r.url,
    description: r.description,
    source_name: r.source_name,
    published_at: r.published_at,
    country: r.country,
    confidence: r.confidence,
    adversary_label: r.adversary_label,
    crowdstrike_adversary: r.crowdstrike_adversary,
    raw_hash: r.raw_hash,
    labels: labels.get(r.id) ?? [],
  });

  const reports = reportRows.map(toRow);
  const breaches = breachRows.map(toRow);
  const vulns = vulnRows.map(toRow);

  return { query: q, reports, breaches, vulns, truncated };
}
