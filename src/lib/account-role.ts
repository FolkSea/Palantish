export type AccountRole = "administrator" | "user";

export function isAccountRole(value: string): value is AccountRole {
  return value === "administrator" || value === "user";
}

export function isAdministrator(role: AccountRole): boolean {
  return role === "administrator";
}
