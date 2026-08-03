// Render one subscriber's owed notifications as a digest email. Pure: no
// network, no database, so the wording and grouping are unit-tested directly.

import type { SubscriptionKind } from "./match";

/** One queued notification, joined to the report it is about. */
export type DigestEntry = {
  reasonKind: SubscriptionKind;
  /** The subscription that matched, as the user typed it. */
  reasonValue: string;
  /** Why the report surfaced now. */
  trigger: "ingest" | "labels" | "attribution";
  title: string;
  url: string | null;
  sourceName: string | null;
  publishedAt: string | null;
  /** The report's page in this app, for a stable link. */
  itemUrl: string | null;
};

export type Digest = { subject: string; text: string; html: string };

const KIND_HEADING: Record<SubscriptionKind, string> = {
  label: "Label",
  adversary: "Adversary",
  country: "Country",
};

// Why the report is being mentioned. Ingest is the ordinary case and needs no
// explanation; the others say so, because "this is not new, it changed" is the
// difference between a useful digest and a confusing one.
const TRIGGER_NOTE: Record<DigestEntry["trigger"], string> = {
  ingest: "",
  labels: " (relabelled)",
  attribution: " (re-attributed)",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const t = Date.parse(value);
  if (Number.isNaN(t)) return "";
  return new Date(t).toISOString().slice(0, 10);
}

/** Group by the subscription that matched, so the digest reads as an answer to
 * what the user asked to watch rather than a flat list of reports. */
function groupByReason(entries: readonly DigestEntry[]) {
  const groups = new Map<string, { kind: SubscriptionKind; value: string; entries: DigestEntry[] }>();
  for (const e of entries) {
    const key = `${e.reasonKind}:${e.reasonValue.toLowerCase()}`;
    const g = groups.get(key);
    if (g) g.entries.push(e);
    else groups.set(key, { kind: e.reasonKind, value: e.reasonValue, entries: [e] });
  }
  // Stable, predictable order: label, adversary, country, then alphabetical.
  const order: SubscriptionKind[] = ["label", "adversary", "country"];
  return [...groups.values()].sort(
    (a, b) =>
      order.indexOf(a.kind) - order.indexOf(b.kind) ||
      a.value.localeCompare(b.value),
  );
}

/**
 * Build the digest. Returns null when there is nothing to say, so callers do not
 * have to special-case an empty send.
 */
export function renderDigest(
  entries: readonly DigestEntry[],
  appUrl: string,
): Digest | null {
  if (entries.length === 0) return null;
  const groups = groupByReason(entries);
  const reportCount = new Set(entries.map((e) => `${e.title}|${e.url ?? ""}`)).size;

  const subject =
    reportCount === 1
      ? "1 new report matching your subscriptions"
      : `${reportCount} new reports matching your subscriptions`;

  const textLines: string[] = [subject, ""];
  const htmlParts: string[] = [
    `<h2 style="font:600 16px system-ui,sans-serif;margin:0 0 16px">${escapeHtml(subject)}</h2>`,
  ];

  for (const group of groups) {
    const heading = `${KIND_HEADING[group.kind]}: ${group.value} (${group.entries.length})`;
    textLines.push(heading);
    htmlParts.push(
      `<h3 style="font:600 13px system-ui,sans-serif;color:#334155;margin:20px 0 6px">${escapeHtml(heading)}</h3>`,
      `<ul style="margin:0;padding-left:18px">`,
    );
    for (const e of group.entries) {
      const meta = [e.sourceName, formatDate(e.publishedAt)].filter(Boolean).join(", ");
      const note = TRIGGER_NOTE[e.trigger];
      const link = e.itemUrl ?? e.url;
      textLines.push(`  - ${e.title}${note}${meta ? ` [${meta}]` : ""}`);
      if (link) textLines.push(`    ${link}`);
      const title = escapeHtml(e.title);
      htmlParts.push(
        `<li style="font:400 13px system-ui,sans-serif;color:#0f172a;margin:0 0 6px">` +
          (link
            ? `<a href="${escapeHtml(link)}" style="color:#1d4ed8">${title}</a>`
            : title) +
          escapeHtml(note) +
          (meta
            ? `<span style="color:#64748b"> - ${escapeHtml(meta)}</span>`
            : "") +
          `</li>`,
      );
    }
    textLines.push("");
    htmlParts.push("</ul>");
  }

  const footer = `Manage these subscriptions at ${appUrl}/settings`;
  textLines.push(footer);
  htmlParts.push(
    `<p style="font:400 12px system-ui,sans-serif;color:#64748b;margin:24px 0 0">` +
      `Manage these subscriptions in <a href="${escapeHtml(appUrl)}/settings" style="color:#1d4ed8">your settings</a>.</p>`,
  );

  return {
    subject,
    text: textLines.join("\n").trim(),
    html: htmlParts.join(""),
  };
}
