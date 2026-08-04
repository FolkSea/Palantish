import { describe, it, expect } from "vitest";
import { modelTierFor, modelForTier } from "@/lib/ingest/enrich/model-tier";
import type { RawCandidate } from "@/lib/ingest/types";

const c = (title: string): RawCandidate => ({
  title,
  url: "https://example.com/a",
  description: null,
  publishedAt: new Date("2026-08-01"),
  sourceName: "Example",
  sourceCategory: "vendor",
});

describe("modelTierFor", () => {
  it("sends CVE records to the cheap model", () => {
    for (const t of [
      "CVE-2026-1234: Remote code execution in Acme Widget",
      "Cisco Unified CM SQL injection (CVE-2026-20230)",
    ]) {
      expect(modelTierFor(c(t)), t).toBe("cheap");
    }
  });

  it("sends vulnerability bulletins to the cheap model", () => {
    for (const t of [
      "Multiple vulnerabilities in Ivanti Sentry",
      "Vulnerabilite dans les produits Moxa",
      "2026-009: Critical Vulnerabilities in Microsoft SharePoint",
      "Oracle Critical Patch Update - July 2026",
      "August 2026 Patch Tuesday",
      "Security advisory for Apache Struts",
    ]) {
      expect(modelTierFor(c(t)), t).toBe("cheap");
    }
  });

  it("keeps real reporting on the standard model", () => {
    // Attribution is where a cheap model's mistakes propagate - into the
    // timeline, the actor cards, subscriptions and the graph.
    for (const t of [
      "Inside Kali365, a device code phishing campaign",
      "Fake Flash Player installs AtlasRAT",
      "North Korean hackers behind open-source supply chain attacks",
      "Ghost Fleet: half of all new scanning infrastructure",
    ]) {
      expect(modelTierFor(c(t)), t).toBe("standard");
    }
  });

  it("keeps an advisory naming a designator-style actor on the standard model", () => {
    // "Ivanti vulnerability exploited by UNC5221" is reporting, however
    // advisory-shaped the rest of the title looks - and attribution is exactly
    // what must not be downgraded. These forms are recognisable without the
    // catalogue; named crews need it (see below).
    for (const t of [
      "Ivanti vulnerability exploited by UNC5221 in the wild",
      "APT28 exploits CVE-2026-1234 against European targets",
      "TA505 linked to a new vulnerability campaign",
    ]) {
      expect(modelTierFor(c(t)), t).toBe("standard");
    }
  });

  it("defaults to standard for anything it cannot place", () => {
    // Downgrading real reporting costs attribution permanently; upgrading a
    // bulletin costs only money.
    expect(modelTierFor(c("Quarterly threat landscape review"))).toBe("standard");
    expect(modelTierFor(c(""))).toBe("standard");
  });

  it("reads the title only, not the body", () => {
    const item = { ...c("Lazarus targets defence contractors"), description: "CVE-2026-1 vulnerability" };
    expect(modelTierFor(item)).toBe("standard");
  });
});

describe("modelForTier", () => {
  it("names a cheap model, and leaves the standard path to its default", () => {
    expect(modelForTier("cheap")).toContain("haiku");
    // undefined means "whatever the agent already uses", so ANTHROPIC_MODEL
    // keeps working for the standard tier.
    expect(modelForTier("standard")).toBeUndefined();
  });
});

describe("catalogue actors keep the strong model", () => {
  const actors = [
    { alias: "dragonforce", nexus: "other" as const },
    { alias: "fancy bear", nexus: "russia" as const },
  ];

  it("recognises a crew the hardcoded list would have missed", () => {
    // This exact title routed cheap on the first pass over the real corpus:
    // it carries a CVE, and DragonForce was not in the hand-written name list.
    // Matching the catalogue instead means nobody maintains a second list.
    const title = "CitrixBleed 2 (CVE-2025-5777) 7Steps to Dragonforce Ransomware";
    expect(modelTierFor(c(title))).toBe("cheap");
    expect(modelTierFor(c(title), actors)).toBe("standard");
  });

  it("keeps advisories that name a catalogue crew on the strong model", () => {
    const named = [
      { alias: "fancy bear", nexus: "russia" as const },
      { alias: "volt typhoon", nexus: "china" as const },
      { alias: "scattered spider", nexus: "other" as const },
    ];
    for (const t of [
      "FANCY BEAR abuses a Zimbra vulnerability",
      "Volt Typhoon exploits multiple vulnerabilities in edge devices",
      "Scattered Spider linked to CVE-2026-9999 exploitation",
    ]) {
      expect(modelTierFor(c(t), named), t).toBe("standard");
    }
  });

  it("still routes a plain advisory cheaply with the catalogue loaded", () => {
    expect(modelTierFor(c("Multiple vulnerabilities in Ivanti Sentry"), actors)).toBe("cheap");
  });

  it("matches on word boundaries, not substrings", () => {
    // "bear" inside another word must not promote an advisory to the strong
    // model - that is the whole point of reusing the rules matcher.
    expect(modelTierFor(c("Vulnerability in Bearing Systems v2"), actors)).toBe("cheap");
  });
});
