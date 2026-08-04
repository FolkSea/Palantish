-- ============================================================================
-- One catalogue entry per actor name.
-- ============================================================================
-- Analysts may now add an actor from the report viewer but never amend or
-- remove one, so "add" has to mean strictly create. The action checks for a
-- colliding name or alias first, to give a useful message; this index is what
-- makes the rule true under a race between that check and the insert.
--
-- Case-insensitive, because attribution matching is: "Fancy Bear" and
-- "FANCY BEAR" are one actor and must not become two entries.
--
-- Safe to add: the catalogue has no duplicate names today (verified before
-- writing this). Should one ever appear, this migration fails loudly rather
-- than silently dropping a row, which is the right way round.
-- ============================================================================

create unique index if not exists adversaries_name_lower_key
  on public.adversaries (lower(name));
