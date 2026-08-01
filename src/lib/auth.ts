import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  isAdministrator,
  type AccountRole,
} from "@/lib/account-role";

export { isAdministrator, type AccountRole } from "@/lib/account-role";

export async function getAuthenticatedClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("account_roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  const role: AccountRole =
    data?.role === "administrator" ? "administrator" : "user";

  return { supabase, user, role };
}

export async function ensureAuthenticated(): Promise<string | null> {
  return (await getAuthenticatedClient()) ? null : "Not authorized.";
}

export async function ensureAdministrator(): Promise<string | null> {
  const auth = await getAuthenticatedClient();
  if (!auth) return "Not authorized.";
  return isAdministrator(auth.role) ? null : "Administrator access required.";
}
