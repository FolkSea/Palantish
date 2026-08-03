"use client";

import {
  Section,
  ReportRow,
  BreachRow,
  VulnRow,
} from "@/components/ResultRows";
import type { FeedResult } from "@/lib/feed";

/**
 * The feed's results, in the same three sections and the same rows as a
 * dashboard search - the components are shared, not reimplemented, so the two
 * views cannot drift apart.
 */
export function FeedResults({ feed }: { feed: FeedResult }) {
  return (
    <div className="mt-3 space-y-4">
      <Section title="Reports" count={feed.reports.length}>
        {feed.reports.map((r) => (
          <ReportRow key={r.id} r={r} />
        ))}
      </Section>
      <Section title="Breaches" count={feed.breaches.length}>
        {feed.breaches.map((b) => (
          <BreachRow key={b.id} b={b} />
        ))}
      </Section>
      <Section title="Exploits and Vulnerabilities" count={feed.vulns.length}>
        {feed.vulns.map((v) => (
          <VulnRow key={v.id} v={v} />
        ))}
      </Section>
    </div>
  );
}
