import { describe, it, expect } from "vitest";
import { parseIocQuery, MAX_IOC_TERMS } from "@/lib/ioc-search";

describe("parseIocQuery", () => {
  it("reads indicators out of ordinary prose", () => {
    const { terms } = parseIocQuery(
      "The actor staged on 45.61.136.5 and evil-update.example, dropping a " +
        "file with SHA256 44d88612fea8a8f36de82e1278abb02f44d88612fea8a8f36de82e1278abb02f.",
    );
    expect(terms).toEqual([
      { value: "45.61.136.5", type: "ip" },
      { value: "evil-update.example", type: "domain" },
      {
        value:
          "44d88612fea8a8f36de82e1278abb02f44d88612fea8a8f36de82e1278abb02f",
        type: "file_hash",
      },
    ]);
  });

  // The whole reason this takes free text: values arrive defanged, and asking
  // an analyst to clean them up first is the work being avoided.
  it("takes defanged values as the same indicator", () => {
    const { terms } = parseIocQuery("hxxps://evil-update[.]example/panel and 45[.]61[.]136[.]5");
    expect(terms.map((t) => t.value).sort()).toEqual([
      "45.61.136.5",
      "evil-update.example",
    ]);
  });

  it("keeps a CIDR range whole", () => {
    const { terms } = parseIocQuery("Scanning came from 104.192.108.0/22.");
    expect(terms).toContainEqual({ value: "104.192.108.0/22", type: "ip" });
  });

  it("searches one indicator once, however many times it is written", () => {
    const { terms } = parseIocQuery(
      "evil.example, EVIL.example, evil[.]example and https://evil.example/x",
    );
    expect(terms).toEqual([{ value: "evil.example", type: "domain" }]);
  });

  // A CVE is better found through the query language, where it can be combined
  // with anything else; picking it up here would silently change the question.
  it("leaves CVEs and techniques alone", () => {
    const { terms } = parseIocQuery("CVE-2026-59310 exploited via T1059.001.");
    expect(terms).toEqual([]);
  });

  it("finds nothing in text that has no indicators in it", () => {
    expect(parseIocQuery("An actor targeted a government ministry.").terms).toEqual(
      [],
    );
    expect(parseIocQuery("").terms).toEqual([]);
  });

  // Groups are sections of results, and a whole report pasted in would produce
  // more than anybody reads. What is left over is counted, not dropped quietly.
  it("caps the search and says how much it left", () => {
    // Routable addresses: the extractor drops private and loopback ranges,
    // which is why nothing stored is ever one.
    const many = Array.from({ length: MAX_IOC_TERMS + 5 }, (_, i) =>
      `45.61.${Math.floor(i / 250) + 1}.${i % 250}`,
    ).join(" ");
    const { terms, overflow } = parseIocQuery(many);
    expect(terms).toHaveLength(MAX_IOC_TERMS);
    expect(overflow).toBe(5);
  });

  // Addresses together, then domains, then hashes - whatever order the text
  // happened to mention them in.
  it("groups the terms by type", () => {
    const { terms } = parseIocQuery("evil.example then 8.8.4.4 then bad.example");
    expect(terms.map((t) => t.type)).toEqual(["ip", "domain", "domain"]);
  });
});
