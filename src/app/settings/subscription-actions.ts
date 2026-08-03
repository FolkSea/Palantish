"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedClient } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SubscriptionKind } from "@/lib/notify/match";

export type SubscriptionRow = {
  id: string;
  kind: SubscriptionKind;
  value: string;
  created_at: string;
};

const KINDS: SubscriptionKind[] = ["label", "adversary", "country"];

function isKind(value: string): value is SubscriptionKind {
  return (KINDS as string[]).includes(value);
}

/** The signed-in user's own subscriptions, newest first. */
export async function listSubscriptions(): Promise<SubscriptionRow[]> {
  const auth = await getAuthenticatedClient();
  if (!auth) return [];
  const { data } = await auth.supabase
    .from("subscriptions")
    .select("id, kind, value, created_at")
    .order("created_at", { ascending: false });
  return (data ?? []) as SubscriptionRow[];
}

/**
 * Subscribe the signed-in user to a label, adversary or country. Writes through
 * the user's own RLS-scoped client, so a user can only ever create their own.
 */
export async function addSubscription(
  kind: string,
  value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await getAuthenticatedClient();
  if (!auth) return { ok: false, error: "Not authorized." };
  if (!isKind(kind)) return { ok: false, error: "Unknown subscription type." };
  const v = value.trim().replace(/\s+/g, " ");
  if (!v) return { ok: false, error: "Enter something to subscribe to." };
  if (v.length > 200) return { ok: false, error: "That value is too long." };

  const { error } = await auth.supabase
    .from("subscriptions")
    .insert({ user_id: auth.user.id, kind, value: v });
  if (error) {
    // The unique index is per user, per kind, per case-insensitive value.
    if (error.code === "23505") return { ok: false, error: "Already subscribed to that." };
    return { ok: false, error: error.message };
  }
  revalidatePath("/settings");
  return { ok: true };
}

export async function removeSubscription(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await getAuthenticatedClient();
  if (!auth) return { ok: false, error: "Not authorized." };
  const { error } = await auth.supabase.from("subscriptions").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Values worth subscribing to, gathered from what has actually been ingested, so
 * the form suggests real labels, actors and countries rather than free text.
 * Read with the admin client because these are catalogue-wide, not per-user.
 */
export async function subscriptionOptions(): Promise<{
  label: string[];
  adversary: string[];
  country: string[];
}> {
  const auth = await getAuthenticatedClient();
  if (!auth) return { label: [], adversary: [], country: [] };
  const db = createAdminClient();

  const [labels, items] = await Promise.all([
    db.from("labels").select("name").order("name"),
    db
      .from("intel_items")
      .select("country, adversary_label, crowdstrike_adversary")
      .limit(4000),
  ]);

  const adversary = new Set<string>();
  const country = new Set<string>();
  for (const row of items.data ?? []) {
    for (const a of [row.adversary_label, row.crowdstrike_adversary]) {
      if (a?.trim()) adversary.add(a.trim());
    }
    if (row.country?.trim()) country.add(row.country.trim());
  }

  const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
  return {
    label: (labels.data ?? []).map((l) => l.name),
    adversary: sorted(adversary),
    country: sorted(country),
  };
}
