"use server";

import { revalidatePath } from "next/cache";
import { getAdministratorClient } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

type ReviewActionResult = { ok: true } | { ok: false; error: string };

async function requireAdministrator(): Promise<ReviewActionResult | null> {
  return (await getAdministratorClient())
    ? null
    : { ok: false, error: "Administrator access required." };
}

/**
 * Accept a flag: delete the indicator, and allowlist it so the next ingest does
 * not put it straight back.
 *
 * The allowlist entry is the point. Deleting alone would clear the graph until
 * the same report was read again, which looks like the fix not working - and
 * the operator has just made exactly the judgement the allowlist records.
 */
export async function removeFlaggedIndicator(
  flagId: string,
): Promise<ReviewActionResult> {
  const denied = await requireAdministrator();
  if (denied) return denied;
  const auth = await getAdministratorClient();
  if (!auth) return { ok: false, error: "Administrator access required." };

  const db = createAdminClient();
  const { data: flag, error: readErr } = await db
    .from("ioc_review_flags")
    .select("id, ioc_id, value, ioc_type, category")
    .eq("id", flagId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!flag) return { ok: false, error: "That flag no longer exists." };

  // Only domain-shaped values can be allowlisted - the allowlist matches hosts
  // and exact IPs, so a URL is recorded by its host and a hash not at all.
  const allowValue = allowlistValueFor(flag.value, flag.ioc_type);
  if (allowValue) {
    const { error: allowErr } = await db.from("ioc_allowlist").upsert(
      {
        value: allowValue,
        ioc_type: flag.ioc_type === "ip" ? "ip" : "domain",
        note: `review: ${flag.category}`,
      },
      { onConflict: "value,ioc_type", ignoreDuplicates: true },
    );
    if (allowErr) return { ok: false, error: allowErr.message };
  }

  // Resolve before deleting: the flag cascades with the indicator, so recording
  // the decision afterwards would have nothing left to write to.
  const { error: resolveErr } = await db
    .from("ioc_review_flags")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: auth.user.id,
      resolution: "removed",
    })
    .eq("id", flagId);
  if (resolveErr) return { ok: false, error: resolveErr.message };

  // Null when the indicator has already gone - deleted from a report view, or
  // by an earlier prune. The decision is still worth recording, and there is
  // simply nothing left to delete.
  if (flag.ioc_id) {
    const { error: delErr } = await db
      .from("iocs")
      .delete()
      .eq("id", flag.ioc_id);
    if (delErr) return { ok: false, error: delErr.message };
  }

  revalidatePath("/settings");
  return { ok: true };
}

/** Reject a flag: the indicator is real, and must not be raised again. */
export async function keepFlaggedIndicator(
  flagId: string,
): Promise<ReviewActionResult> {
  const denied = await requireAdministrator();
  if (denied) return denied;
  const auth = await getAdministratorClient();
  if (!auth) return { ok: false, error: "Administrator access required." };

  const db = createAdminClient();
  const { error } = await db
    .from("ioc_review_flags")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: auth.user.id,
      resolution: "kept",
    })
    .eq("id", flagId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true };
}

/** What to record in the allowlist for a flagged value, or null if nothing can be. */
function allowlistValueFor(value: string, iocType: string): string | null {
  if (iocType === "domain") return value.toLowerCase().trim() || null;
  if (iocType === "ip") return value.trim() || null;
  if (iocType === "uri") {
    try {
      return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return null;
    }
  }
  // A file hash is specific to one artefact; allowlisting it protects nothing.
  return null;
}
