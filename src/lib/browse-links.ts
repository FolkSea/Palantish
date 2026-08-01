// Links into the /reports browse view. Pure (no React, no server imports) so the
// badges, chips and the route itself all agree on one URL shape, and so the
// parsing is unit-tested directly.

export type BrowseKind = "label" | "adversary" | "source";

export type BrowseFilter = { kind: BrowseKind; value: string };

/** Human wording for the filter, used in the page heading and the empty state. */
export const BROWSE_KIND_LABEL: Record<BrowseKind, string> = {
  label: "Label",
  adversary: "Adversary",
  source: "Source",
};

const BASE = "/reports";

function href(kind: BrowseKind, value: string): string {
  const v = (value ?? "").trim();
  if (!v) return BASE;
  return `${BASE}?${kind}=${encodeURIComponent(v)}`;
}

/** Reports carrying a given label (e.g. Malware/FlyingEagle). */
export function labelHref(name: string): string {
  return href("label", name);
}

/** Reports attributed to a given adversary. */
export function adversaryHref(name: string): string {
  return href("adversary", name);
}

/** Reports from a given feed/source. */
export function sourceHref(name: string): string {
  return href("source", name);
}

/**
 * A single report's own page. `key` is the report's raw_hash (what every call
 * site already carries) - the route also accepts the intel_items uuid, so links
 * made from either identifier resolve.
 */
export function itemHref(key: string | null | undefined): string {
  const v = (key ?? "").trim();
  return v ? `/item/${encodeURIComponent(v)}` : "/";
}

/**
 * Read the filter out of the route's search params. Exactly one filter applies;
 * when several are present they resolve in a fixed order so a URL always means
 * one thing. Returns null when nothing usable was supplied.
 */
export function parseBrowseParams(
  params: Partial<Record<BrowseKind, string | string[]>>,
): BrowseFilter | null {
  const order: BrowseKind[] = ["label", "adversary", "source"];
  for (const kind of order) {
    const raw = params[kind];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (value) return { kind, value };
  }
  return null;
}
