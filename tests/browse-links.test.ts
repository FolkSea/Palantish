import { describe, it, expect } from "vitest";
import {
  labelHref,
  adversaryHref,
  sourceHref,
  parseBrowseParams,
} from "@/lib/browse-links";

describe("browse hrefs", () => {
  it("builds a filtered /reports link per kind", () => {
    expect(labelHref("Malware/FlyingEagle")).toBe(
      "/reports?label=Malware%2FFlyingEagle",
    );
    expect(adversaryHref("FANCY BEAR")).toBe("/reports?adversary=FANCY%20BEAR");
    expect(sourceHref("The Record")).toBe("/reports?source=The%20Record");
  });

  it("encodes values that would otherwise break the query string", () => {
    // A label is Prefix/Value and an actor name can carry punctuation.
    expect(labelHref("Target/F5 BIG-IP")).toContain("Target%2FF5%20BIG-IP");
    expect(sourceHref("A&B News")).toContain("A%26B%20News");
    expect(adversaryHref("VOID DOKKAEBI (Chollima)")).not.toContain(" ");
  });

  it("falls back to the bare route for an empty value", () => {
    expect(labelHref("")).toBe("/reports");
    expect(sourceHref("   ")).toBe("/reports");
  });

  it("round-trips through the parser", () => {
    const value = "Malware/FlyingEagle";
    const qs = labelHref(value).split("?")[1];
    const parsed = Object.fromEntries(new URLSearchParams(qs));
    expect(parseBrowseParams(parsed)).toEqual({ kind: "label", value });
  });
});

describe("parseBrowseParams", () => {
  it("reads each supported filter", () => {
    expect(parseBrowseParams({ label: "X" })).toEqual({ kind: "label", value: "X" });
    expect(parseBrowseParams({ adversary: "Y" })).toEqual({
      kind: "adversary",
      value: "Y",
    });
    expect(parseBrowseParams({ source: "Z" })).toEqual({
      kind: "source",
      value: "Z",
    });
  });

  it("resolves a repeated param and trims whitespace", () => {
    expect(parseBrowseParams({ source: ["A", "B"] })).toEqual({
      kind: "source",
      value: "A",
    });
    expect(parseBrowseParams({ label: "  L  " })).toEqual({
      kind: "label",
      value: "L",
    });
  });

  it("applies a fixed precedence so a URL always means one thing", () => {
    expect(parseBrowseParams({ source: "S", adversary: "A", label: "L" })).toEqual(
      { kind: "label", value: "L" },
    );
  });

  it("is null when nothing usable is supplied", () => {
    expect(parseBrowseParams({})).toBeNull();
    expect(parseBrowseParams({ label: "" })).toBeNull();
    expect(parseBrowseParams({ source: "   " })).toBeNull();
  });
});
