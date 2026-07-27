/** Format a YYYY-MM-DD date string as "Mon D, YYYY" without timezone shifts. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  // date-only values: parse as UTC noon to avoid off-by-one from local tz.
  const d = value.length <= 10 ? new Date(`${value}T12:00:00Z`) : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
