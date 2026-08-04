import { describe, it, expect } from "vitest";
import { findActorCollision, namesOf } from "@/lib/actor-collision";

const catalogue = [
  { id: "1", name: "FANCY BEAR", aliases: ["APT28", "Sofacy"] },
  { id: "2", name: "DragonForce", aliases: null },
];

describe("namesOf", () => {
  it("collects the name and every alias, normalised", () => {
    expect(namesOf(catalogue[0])).toEqual(["fancy bear", "apt28", "sofacy"]);
  });

  it("survives missing, null and blank aliases", () => {
    expect(namesOf({ name: "X", aliases: null })).toEqual(["x"]);
    expect(namesOf({ name: "X" })).toEqual(["x"]);
    expect(namesOf({ name: " X ", aliases: ["", "  ", null] })).toEqual(["x"]);
  });
});

describe("findActorCollision", () => {
  it("lets a genuinely new actor through", () => {
    expect(
      findActorCollision({ name: "Silver Fox", aliases: ["SF-1"] }, catalogue),
    ).toBeNull();
  });

  it("catches a duplicate name whatever its case or padding", () => {
    const hit = findActorCollision({ name: "  fancy bear " }, catalogue);
    expect(hit?.actor.id).toBe("1");
    expect(hit?.on).toBe("fancy bear");
  });

  it("catches a new actor claiming an existing actor's alias", () => {
    // The case that matters: attribution matches on aliases, so this would
    // re-point FANCY BEAR's reporting at a new entry.
    const hit = findActorCollision({ name: "Brand New", aliases: ["APT28"] }, catalogue);
    expect(hit?.actor.id).toBe("1");
    expect(hit?.on).toBe("apt28");
  });

  it("catches a new actor whose name is an existing alias", () => {
    const hit = findActorCollision({ name: "Sofacy" }, catalogue);
    expect(hit?.actor.id).toBe("1");
  });

  it("catches a collision against an actor with no aliases", () => {
    expect(findActorCollision({ name: "dragonforce" }, catalogue)?.actor.id).toBe("2");
  });

  it("treats a nameless proposal as no collision, leaving validation to the caller", () => {
    expect(findActorCollision({ name: "   " }, catalogue)).toBeNull();
  });

  it("finds nothing in an empty catalogue", () => {
    expect(findActorCollision({ name: "FANCY BEAR" }, [])).toBeNull();
  });
});
