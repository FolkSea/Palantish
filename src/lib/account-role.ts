export type AccountRole = "administrator" | "user";

export function isAdministrator(role: AccountRole): boolean {
  return role === "administrator";
}
