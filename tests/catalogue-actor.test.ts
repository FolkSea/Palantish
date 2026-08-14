import { describe, it, expect } from "vitest";
import {
  canBeCatalogued,
  resolveKnownActor,
  provisionalActorRow,
  PROVISIONAL,
} from "@/lib/ingest/catalogue";

describe("canBeCatalogued", () => {
  // The case this exists for: Symantec named Jewelbug, the catalogue had never
  // heard of it, and the attribution was dropped on the floor.
  it("accepts an actor name a vendor coined", () => {
    for (const name of ["Jewelbug", "Earth Alux", "APT41", "REF7707", "CL-STA-0049"])
      expect(canBeCatalogued(name)).toBe(true);
  });

  // A catalogue entry is also a matcher: every future report containing the
  // name attributes to it. An ordinary word would attribute half the corpus.
  it("refuses a name that would match ordinary prose", () => {
    for (const name of ["Lead", "Play", "Snake", "", "AB"])
      expect(canBeCatalogued(name)).toBe(false);
  });

  // These are how the dashboard says it does not know who did it.
  it("refuses the generic placeholders", () => {
    for (const name of ["UNID PANDA", "PANDA", "Bear"])
      expect(canBeCatalogued(name)).toBe(false);
  });
});

describe("resolveKnownActor", () => {
  const catalogue = [
    {
      name: "MUSTANG PANDA",
      community_identifiers: ["Twill Typhoon", "Earth Preta"],
      internal_alternative_names: null,
    },
    { name: "WICKED PANDA", community_identifiers: ["APT41"] },
  ];

  it("matches on an alias, so one actor keeps one entry", () => {
    expect(resolveKnownActor("Earth Preta", catalogue)).toBe("MUSTANG PANDA");
    expect(resolveKnownActor("apt41", catalogue)).toBe("WICKED PANDA");
  });

  it("matches the preferred name whatever its case", () => {
    expect(resolveKnownActor("wicked panda", catalogue)).toBe("WICKED PANDA");
  });

  it("returns null for an actor nobody has listed", () => {
    expect(resolveKnownActor("Jewelbug", catalogue)).toBeNull();
  });
});

describe("provisionalActorRow", () => {
  it("takes the country from the nexus and marks the entry unreviewed", () => {
    const row = provisionalActorRow("Jewelbug", "china");
    expect(row).toMatchObject({
      name: "Jewelbug",
      nexus: "china",
      country: "China",
      motivation: ["nation_state"],
      status: PROVISIONAL,
    });
  });

  // Without a country there is nothing to base a motivation on, and a guess
  // would file the actor under a heading on the dashboard.
  it("claims no motivation when the nexus names no country", () => {
    const row = provisionalActorRow("Jewelbug", "other");
    expect(row.country).toBeNull();
    expect(row.motivation).toBeNull();
  });

  // An alias attributes every future report that mentions it. The model may
  // well have listed some; a person decides whether they hold.
  it("adds no aliases", () => {
    expect(provisionalActorRow("Jewelbug", "china").community_identifiers).toEqual([]);
  });
});
