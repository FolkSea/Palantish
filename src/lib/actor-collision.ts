// Whether a proposed actor already exists in the catalogue.
//
// Analysts may add an actor from the report viewer but never change or remove
// one, so "add" has to mean strictly create. A name is the obvious collision,
// but an alias is the one that matters: attribution matches on aliases, so a
// new entry claiming an alias another actor already answers to would quietly
// re-point reporting at the wrong actor - which is the harm the create-only
// rule exists to prevent.
//
// Pure, so the rule is testable without a database.

export type ActorNames = {
  name: string;
  /** Community identifiers and internal alternatives, however stored. */
  aliases?: (string | null)[] | null;
};

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Every name an actor answers to, normalised and de-duplicated. */
export function namesOf(actor: ActorNames): string[] {
  return [
    ...new Set(
      [actor.name, ...(actor.aliases ?? [])].map(normalize).filter(Boolean),
    ),
  ];
}

/**
 * The existing actor a proposed one would collide with, or null when the
 * catalogue has nothing by any of its names.
 */
export function findActorCollision<T extends ActorNames>(
  proposed: ActorNames,
  existing: T[],
): { actor: T; on: string } | null {
  const wanted = new Set(namesOf(proposed));
  if (wanted.size === 0) return null;
  for (const actor of existing) {
    for (const name of namesOf(actor)) {
      if (wanted.has(name)) return { actor, on: name };
    }
  }
  return null;
}
