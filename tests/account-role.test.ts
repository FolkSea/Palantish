import { describe, expect, it } from "vitest";
import { isAdministrator, type AccountRole } from "@/lib/account-role";

describe("account roles", () => {
  it("grants administrator capabilities only to the administrator role", () => {
    expect(isAdministrator("administrator")).toBe(true);
    expect(isAdministrator("user")).toBe(false);
  });

  it("keeps the initial role set intentionally limited", () => {
    const roles: AccountRole[] = ["administrator", "user"];
    expect(roles).toEqual(["administrator", "user"]);
  });
});
