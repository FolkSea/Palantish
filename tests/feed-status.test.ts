import { describe, it, expect } from "vitest";
import { feedHealth, needsAttention, STALE_DAYS } from "@/lib/feed-status";

const NOW = Date.parse("2026-08-04T12:00:00Z");
const daysAgo = (n: number) =>
  new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

const feed = (over: Partial<Parameters<typeof feedHealth>[0]> = {}) => ({
  active: true,
  feedUrl: "https://example.com/rss",
  lastItemAt: daysAgo(1),
  lastFetchedAt: daysAgo(1),
  lastError: null,
  ...over,
});

describe("feedHealth", () => {
  it("separates the switch from the state", () => {
    // The bug this fixes: a feed the dashboard was warning about still read as
    // "Active" in the list, because active only ever meant "switched on".
    expect(feedHealth(feed({ active: false }), NOW)).toBe("off");
    expect(feedHealth(feed({ lastItemAt: daysAgo(60) }), NOW)).toBe("stale");
  });

  it("calls a fresh feed ok", () => {
    expect(feedHealth(feed(), NOW)).toBe("ok");
    expect(feedHealth(feed({ lastItemAt: daysAgo(STALE_DAYS - 1) }), NOW)).toBe("ok");
  });

  it("goes stale just past the window", () => {
    expect(feedHealth(feed({ lastItemAt: daysAgo(STALE_DAYS + 1) }), NOW)).toBe("stale");
  });

  it("distinguishes a feed that has never produced anything", () => {
    // Both CERT-EU feeds were in this state - not stale exactly, but never
    // having delivered, which reads differently to someone deciding what to fix.
    expect(feedHealth(feed({ lastItemAt: null }), NOW)).toBe("never");
  });

  it("prefers the error, which explains the silence", () => {
    expect(
      feedHealth(feed({ lastItemAt: daysAgo(90), lastError: "404" }), NOW),
    ).toBe("error");
  });

  it("does not call a switched-off feed stale or broken", () => {
    // Turning a feed off is a decision, not a fault to be reported.
    expect(feedHealth(feed({ active: false, lastError: "404" }), NOW)).toBe("off");
    expect(feedHealth(feed({ active: false, lastItemAt: null }), NOW)).toBe("off");
  });

  it("leaves a source with nothing to fetch alone", () => {
    // A manual source has no feed, so silence means nothing.
    expect(feedHealth(feed({ feedUrl: null, lastItemAt: null }), NOW)).toBe("ok");
  });

  it("treats an unparseable timestamp as never, not as fresh", () => {
    expect(feedHealth(feed({ lastItemAt: "not a date" }), NOW)).toBe("never");
  });
});

describe("needsAttention", () => {
  it("flags exactly the states the dashboard warns about", () => {
    expect(needsAttention("stale")).toBe(true);
    expect(needsAttention("never")).toBe(true);
    expect(needsAttention("error")).toBe(true);
    expect(needsAttention("ok")).toBe(false);
    expect(needsAttention("off")).toBe(false);
  });
});
