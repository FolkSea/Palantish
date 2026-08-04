// The stored form of an allow-listed email.
//
// Pure and separate from the lookup so it can be tested: the table stores lower
// case and the SQL gate lower-cases the JWT claim, so the application has to
// agree. If it did not, a capitalised sign-in would be told it is not approved
// while the database served it perfectly happily.

export function normalizeAllowlistEmail(
  value: string | null | undefined,
): string {
  return (value ?? "").trim().toLowerCase();
}
