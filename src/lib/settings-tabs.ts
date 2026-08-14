// Which settings panel is showing.
//
// Here rather than in SettingsView because that is a client component: a server
// page cannot call a function exported from one, however happily it type-checks.

export type SettingsTab =
  | "account"
  | "subscriptions"
  | "users"
  | "sources"
  | "actors"
  | "hidden"
  | "dropped"
  | "review"
  | "unclassified"
  | "memory";

export const SETTINGS_TABS: SettingsTab[] = [
  "account",
  "subscriptions",
  "users",
  "sources",
  "actors",
  "hidden",
  "dropped",
  "review",
  "unclassified",
  "memory",
];

/** A ?tab= value, or undefined so the caller falls back rather than showing nothing. */
export function parseSettingsTab(
  value: string | undefined,
): SettingsTab | undefined {
  return SETTINGS_TABS.find((t) => t === value);
}
