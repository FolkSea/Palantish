"use server";

import { revalidatePath } from "next/cache";
import { getAdministratorClient } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

type ReviewActionResult =
  | { ok: true; affected: number }
  | { ok: false; error: string };

/**
 * Accept flags: delete each indicator, and allowlist it so the next ingest does
 * not put it straight back.
 *
 * The allowlist entry is the point. Deleting alone would clear the graph until
 * the same report was read again, which looks like the fix not working - and
 * the operator has just made exactly the judgement the allowlist records.
 *
 * Takes a list because the panel decides in bulk. Done in a handful of
 * statements rather than a round trip per flag: a hundred sequential deletes is
 * slow enough that an operator gives up on it half finished, which is the one
 * way to end with indicators deleted but not allowlisted.
 */
export async function removeFlaggedIndicators(
  flagIds: string[],
): Promise<ReviewActionResult> {
  const auth = await getAdministratorClient();
  if (!auth) return { ok: false, error: "Administrator access required." };
  if (flagIds.length === 0) return { ok: true, affected: 0 };

  const db = createAdminClient();
  const { data: flags, error: readErr } = await db
    .from("ioc_review_flags")
    .select("id, ioc_id, value, ioc_type, category")
    .in("id", flagIds)
    .is("resolved_at", null);
  if (readErr) return { ok: false, error: readErr.message };
  if (!flags || flags.length === 0) {
    return { ok: false, error: "Those flags have already been resolved." };
  }

  // Only domain-shaped values can be allowlisted - the allowlist matches hosts
  // and exact IPs, so a URL is recorded by its host and a hash not at all.
  const allowRows = flags
    .map((f) => {
      const value = allowlistValueFor(f.value, f.ioc_type);
      return value
        ? {
            value,
            ioc_type: f.ioc_type === "ip" ? "ip" : "domain",
            note: `review: ${f.category}`,
          }
        : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  // Dedupe: several flagged URLs can share one host, and upserting the same
  // value twice in one statement is an error rather than a no-op.
  const uniqueAllow = [
    ...new Map(allowRows.map((r) => [`${r.value}|${r.ioc_type}`, r])).values(),
  ];
  if (uniqueAllow.length > 0) {
    const { error: allowErr } = await db
      .from("ioc_allowlist")
      .upsert(uniqueAllow, {
        onConflict: "value,ioc_type",
        ignoreDuplicates: true,
      });
    if (allowErr) return { ok: false, error: allowErr.message };
  }

  // Resolve before deleting. The flag's ioc_id is nulled by the delete, so the
  // decision has to be written while there is still something to write it
  // against - and if the delete then fails, the record is the honest one.
  const { error: resolveErr } = await db
    .from("ioc_review_flags")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: auth.user.id,
      resolution: "removed",
    })
    .in(
      "id",
      flags.map((f) => f.id),
    );
  if (resolveErr) return { ok: false, error: resolveErr.message };

  // Null when the indicator has already gone - deleted from a report view, or
  // by an earlier prune. The decision still stands; there is nothing to delete.
  const iocIds = flags
    .map((f) => f.ioc_id)
    .filter((id): id is string => id !== null);
  if (iocIds.length > 0) {
    const { error: delErr } = await db.from("iocs").delete().in("id", iocIds);
    if (delErr) return { ok: false, error: delErr.message };
  }

  revalidatePath("/settings");
  return { ok: true, affected: flags.length };
}

/** Reject flags: the indicators are real, and must not be raised again. */
export async function keepFlaggedIndicators(
  flagIds: string[],
): Promise<ReviewActionResult> {
  const auth = await getAdministratorClient();
  if (!auth) return { ok: false, error: "Administrator access required." };
  if (flagIds.length === 0) return { ok: true, affected: 0 };

  const db = createAdminClient();
  const { data, error } = await db
    .from("ioc_review_flags")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: auth.user.id,
      resolution: "kept",
    })
    .in("id", flagIds)
    .is("resolved_at", null)
    .select("id");
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true, affected: data?.length ?? 0 };
}

/** What to record in the allowlist for a flagged value, or null if nothing can be. */
function allowlistValueFor(value: string, iocType: string): string | null {
  if (iocType === "domain") return value.toLowerCase().trim() || null;
  if (iocType === "ip") return value.trim() || null;
  // A file hash is specific to one artefact; allowlisting it protects nothing.
  return null;
}
