-- ============================================================================
-- Single actor classification
-- ----------------------------------------------------------------------------
-- Retire the actor_families lookup and store an actor's classification directly
-- on the adversaries (actor) table: a motivation (nation_state / ecrime /
-- hacktivism) and, for nation-state actors, a country. This ensures newly added
-- adversaries are grouped correctly without a separate family table.
-- ============================================================================

alter table adversaries add column if not exists country text;

-- Backfill country from the family mapping.
update adversaries a
set country = f.country
from actor_families f
where upper(a.animal_classifier) = upper(f.animal)
  and f.country is not null;

-- Re-express motivation using the focus vocabulary. Prefer the family focus,
-- then the derived nexus, then a hacktivism hint in the old motivation, else
-- eCrime.
update adversaries a
set motivation = array[
  coalesce(
    (select f.focus
       from actor_families f
      where upper(f.animal) = upper(a.animal_classifier)
      limit 1),
    case
      when a.nexus in ('china', 'russia', 'north_korea', 'iran', 'rest_of_world')
        then 'nation_state'
      when array_to_string(a.motivation, ',') ilike '%hacktivism%'
        then 'hacktivism'
      else 'ecrime'
    end
  )
];

-- Constrain motivation to the three known focus values.
alter table adversaries drop constraint if exists adversaries_motivation_chk;
alter table adversaries
  add constraint adversaries_motivation_chk
  check (motivation <@ array['nation_state', 'ecrime', 'hacktivism']);

-- actor_families is now redundant (its animal -> focus/country data lives on
-- each adversary, and the ingest derives nexus from the animal cryptonym).
drop table if exists actor_families;
