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

/**
 * Date and time, for audit-style lists where the hour matters.
 *
 * Fixed locale and UTC on purpose: this renders on the server and again on the
 * client, and anything locale- or timezone-dependent would differ between the
 * two and trip a hydration warning. Callers should say "UTC" in the heading.
 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = value.length <= 10 ? new Date(`${value}T12:00:00Z`) : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const date = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
  return `${date} ${time}`;
}
