// Which subscriptions a report satisfies. Pure, so the rules are unit-tested
// directly and the same function decides at ingest and at edit time.

export type SubscriptionKind = "label" | "adversary" | "country";

export type Subscription = {
  id: string;
  userId: string;
  kind: SubscriptionKind;
  value: string;
};

/** The parts of a report a subscription can match on. */
export type NotifiableReport = {
  id: string;
  labels: string[];
  /** Both spellings of the actor: the stored attribution and the feed's own. */
  adversaries: (string | null | undefined)[];
  country: string | null | undefined;
};

export type Match = {
  subscription: Subscription;
  /** The report's value that matched, as stored - shown in the digest. */
  matched: string;
};

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Labels are a taxonomy - `Malware/BRICKSTORM`, `Target/Zimbra` - so a
 * subscription to a branch covers everything under it: `Malware` matches
 * `Malware/BRICKSTORM` but not `MalwareAnalysis`. An exact match always counts.
 */
export function labelMatches(subscribed: string, label: string): boolean {
  const want = norm(subscribed);
  const have = norm(label);
  if (!want || !have) return false;
  if (want === have) return true;
  // Only on the separator, so a subscription cannot half-match a name.
  return have.startsWith(`${want}/`);
}

/** Actors and countries are named things, so they match exactly (any casing). */
function exactMatches(subscribed: string, value: string | null | undefined): boolean {
  const want = norm(subscribed);
  return want.length > 0 && want === norm(value);
}

function valuesFor(report: NotifiableReport, kind: SubscriptionKind): string[] {
  if (kind === "label") return report.labels;
  if (kind === "adversary") {
    return report.adversaries.filter((a): a is string => !!a && !!a.trim());
  }
  return report.country ? [report.country] : [];
}

/**
 * Every subscription this report satisfies, with the report's own value that
 * matched. One subscription yields at most one match even when several of the
 * report's labels sit under it, so a digest says a thing once.
 */
export function matchSubscriptions(
  report: NotifiableReport,
  subscriptions: readonly Subscription[],
): Match[] {
  const out: Match[] = [];
  for (const subscription of subscriptions) {
    const candidates = valuesFor(report, subscription.kind);
    const matched = candidates.find((value) =>
      subscription.kind === "label"
        ? labelMatches(subscription.value, value)
        : exactMatches(subscription.value, value),
    );
    if (matched) out.push({ subscription, matched });
  }
  return out;
}
