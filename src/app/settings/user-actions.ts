"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getAdministratorClient } from "@/lib/auth";
import { isAccountRole, type AccountRole } from "@/lib/account-role";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ManagedUser } from "@/lib/user-management-types";

type UserActionResult =
  | { ok: true; user?: ManagedUser; message?: string }
  | { ok: false; error: string };

function normalizedEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

async function callbackUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  if (!host) throw new Error("Could not determine the application URL.");
  return `${proto}://${host}/auth/confirm?next=/settings`;
}

async function requireAdministrator(): Promise<UserActionResult | null> {
  return (await getAdministratorClient())
    ? null
    : { ok: false, error: "Administrator access required." };
}

export async function inviteUserAction(input: {
  email: string;
  displayName: string;
  role: AccountRole;
}): Promise<UserActionResult> {
  const denied = await requireAdministrator();
  if (denied) return denied;
  const email = normalizedEmail(input.email);
  if (!email) return { ok: false, error: "Enter a valid email address." };
  if (!isAccountRole(input.role))
    return { ok: false, error: "Invalid access level." };

  const db = createAdminClient();
  const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
    redirectTo: await callbackUrl(),
    data: { display_name: input.displayName.trim() },
  });
  if (error || !data.user)
    return { ok: false, error: error?.message ?? "Could not create user." };

  const roleUpdate = await db.from("account_roles").upsert({
    user_id: data.user.id,
    role: input.role,
  });
  if (roleUpdate.error)
    return {
      ok: false,
      error: `User invited, but access level could not be saved: ${roleUpdate.error.message}`,
    };

  revalidatePath("/settings");
  return {
    ok: true,
    user: {
      id: data.user.id,
      email,
      displayName: input.displayName.trim(),
      role: input.role,
      createdAt: data.user.created_at,
      lastSignInAt: null,
    },
    message: `Invitation sent to ${email}.`,
  };
}

export async function updateUserRoleAction(
  userId: string,
  role: AccountRole,
): Promise<UserActionResult> {
  const denied = await requireAdministrator();
  if (denied) return denied;
  if (!isAccountRole(role)) return { ok: false, error: "Invalid access level." };

  const db = createAdminClient();
  const current = await db
    .from("account_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (current.error) return { ok: false, error: current.error.message };

  if (current.data?.role === "administrator" && role === "user") {
    const { count, error } = await db
      .from("account_roles")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "administrator");
    if (error) return { ok: false, error: error.message };
    if ((count ?? 0) <= 1)
      return { ok: false, error: "The final Administrator cannot be demoted." };
  }

  const { error } = await db.from("account_roles").upsert({
    user_id: userId,
    role,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true, message: "Access level updated." };
}

export async function sendPasswordResetAction(
  emailInput: string,
): Promise<UserActionResult> {
  const denied = await requireAdministrator();
  if (denied) return denied;
  const email = normalizedEmail(emailInput);
  if (!email) return { ok: false, error: "Invalid account email." };

  const { error } = await createAdminClient().auth.resetPasswordForEmail(email, {
    redirectTo: await callbackUrl(),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: `Password reset sent to ${email}.` };
}
