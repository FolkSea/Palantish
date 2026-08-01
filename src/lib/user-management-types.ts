import type { AccountRole } from "@/lib/account-role";

export type ManagedUser = {
  id: string;
  email: string;
  displayName: string;
  role: AccountRole;
  createdAt: string;
  lastSignInAt: string | null;
};
