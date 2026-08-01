import "server-only";

import { getAdministratorClient } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AccountRole } from "@/lib/account-role";
import type { ManagedUser } from "@/lib/user-management-types";

/** List all Supabase Auth accounts with their application access level. */
export async function listManagedUsers(): Promise<ManagedUser[]> {
  if (!(await getAdministratorClient())) return [];

  const db = createAdminClient();
  const [authResult, roleResult] = await Promise.all([
    db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    db.from("account_roles").select("user_id, role"),
  ]);
  if (authResult.error) throw new Error(authResult.error.message);
  if (roleResult.error) throw new Error(roleResult.error.message);

  const roleByUser = new Map<string, AccountRole>(
    (roleResult.data ?? []).map((row) => [row.user_id, row.role]),
  );
  return authResult.data.users
    .map((user) => ({
      id: user.id,
      email: user.email ?? "",
      displayName:
        typeof user.user_metadata?.display_name === "string"
          ? user.user_metadata.display_name
          : "",
      role: roleByUser.get(user.id) ?? "user",
      createdAt: user.created_at,
      lastSignInAt: user.last_sign_in_at ?? null,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}
