import { describe, it, expect } from "vitest";
import { parseFeedDate } from "@/lib/ingest/dates";

describe("parseFeedDate", () => {
  it("passes through what the engine already handles", () => {
    expect(parseFeedDate("Thu, 23 Jul 2026 09:13:03 +0200")?.toISOString())
      .toBe("2026-07-23T07:13:03.000Z");
    expect(parseFeedDate("2026-07-23T09:13:03Z")?.toISOString())
      .toBe("2026-07-23T09:13:03.000Z");
  });

  it("rescues a European zone name, which the engine rejects outright", () => {
    // Exactly what CERT-EU publishes. new Date() returns Invalid Date for this,
    // which silently left every advisory undated and the feed marked stale.
    expect(parseFeedDate("Thu, 23 Jul 2026 09:13:03 CEST")?.toISOString())
      .toBe("2026-07-23T07:13:03.000Z");
    expect(parseFeedDate("Wed, 14 Jan 2026 16:00:00 CET")?.toISOString())
      .toBe("2026-01-14T15:00:00.000Z");
  });

  it("applies summer time as one hour more than winter", () => {
    const cet = parseFeedDate("Wed, 14 Jan 2026 12:00:00 CET")!;
    const cest = parseFeedDate("Wed, 14 Jan 2026 12:00:00 CEST")!;
    expect(cet.getTime() - cest.getTime()).toBe(60 * 60 * 1000);
  });

  it("covers the other zones European feeds emit", () => {
    for (const [zone, utcHour] of [["WET", 12], ["WEST", 11], ["EET", 10], ["EEST", 9]] as const) {
      expect(parseFeedDate(`Wed, 14 Jan 2026 12:00:00 ${zone}`)?.getUTCHours(), zone)
        .toBe(utcHour);
    }
  });

  it("returns null rather than a wrong date", () => {
    // A date silently landing in 1970, or in the server's own timezone, is far
    // worse than an item the pipeline simply treats as undated.
    for (const bad of ["", "   ", "not a date", "Thu, 23 Jul 2026 09:13:03 XYZ"]) {
      expect(parseFeedDate(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(parseFeedDate(undefined)).toBeNull();
    expect(parseFeedDate(null)).toBeNull();
  });
});
