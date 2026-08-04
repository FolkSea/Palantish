import { describe, it, expect } from "vitest";
import { normalizeAllowlistEmail } from "@/lib/allowlist-email";

describe("normalizeAllowlistEmail", () => {
  it("matches regardless of case or padding", () => {
    // The table stores lower case and the SQL gate lower-cases the JWT claim,
    // so the app has to agree or a capitalised sign-in would be told it is not
    // approved while the database happily served it.
    expect(normalizeAllowlistEmail("  Andy@Example.COM ")).toBe("andy@example.com");
    expect(normalizeAllowlistEmail("andy@example.com")).toBe("andy@example.com");
  });

  it("yields empty for nothing, so a blank never matches a row", () => {
    for (const v of ["", "   ", null, undefined]) {
      expect(normalizeAllowlistEmail(v)).toBe("");
    }
  });
});
