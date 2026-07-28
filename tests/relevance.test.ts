import { describe, it, expect } from "vitest";
import { isThreatIntel } from "@/lib/relevance";

// Real leaked titles observed on the dashboard that must be filtered out.
const MARKETING_OR_OFFTOPIC = [
  "5 High-Impact Use Cases for Falcon Onum",
  "CrowdStrike Joins the Open Secure AI Alliance to Advance AI Safety and Security",
  "CrowdStrike Falcon Platform Helps Meet U.S. Government Mandates for CISA BOD-26-04",
  "Real world incident response: Microsoft and AXA XL strengthen cyber resilience",
  "Preview: Cisco Talos at Black Hat USA 2026",
  "Pwn2Own Ireland 2026 - New Targets and Categories",
  "A week in security (July 20 - July 26)",
  "What's your data worth on the dark web? (Lock and Code S07E15)",
  "Don't get fooled by TikTok resin art scams",
  "Don't trust that \"FBI agent\" in your DMs",
  "AI nudify apps spark legal scrutiny of Apple and Google's profits",
];

// Real threat-intel titles that must be kept.
const THREAT_INTEL = [
  "New ClickLock Stealer locks your Mac until you hand over your password",
  "Sextortion scammers are exploiting ShinyHunters data leaks",
  "Russian State-Supported Cyber Actors Conduct Phishing Campaign Targeting Users of Zimbra Collaboration Suite",
  "Chaos ransomware's msaRAT: Living off the browser to build a covert C2 channel",
  "Johnson Controls C-CURE 9000 and Victor application server",
  "Paidwork breach exposes data of 23 million users: Check if you're affected",
  "Iran War Cyber Threat Landscape | A Midyear Assessment on What Matters",
  "Email threat landscape: Q2 2026 trends and insights",
  "Mirage Kitten targets Middle East and Africa region with new malware",
];

describe("isThreatIntel", () => {
  it.each(MARKETING_OR_OFFTOPIC)("drops off-topic: %s", (title) => {
    expect(isThreatIntel(title)).toBe(false);
  });

  it.each(THREAT_INTEL)("keeps threat intel: %s", (title) => {
    expect(isThreatIntel(title)).toBe(true);
  });

  it("does not drop government advisories that mention partners", () => {
    expect(
      isThreatIntel(
        "CISA, NSA, FBI and Partners Warn Zimbra Users of Russian State-Supported Activity",
      ),
    ).toBe(true);
  });

  it("does not drop state-sponsored actor reporting", () => {
    expect(
      isThreatIntel("State-sponsored hackers breach telecom providers"),
    ).toBe(true);
  });

  it("keeps an off-topic phrasing when a concrete threat signal is present", () => {
    // "use cases" would normally drop, but a CVE reference overrides it.
    expect(
      isThreatIntel("Use cases for detecting CVE-2026-12345 exploitation"),
    ).toBe(true);
  });
});
