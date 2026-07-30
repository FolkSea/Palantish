-- ============================================================================
-- Move nation-state attribution onto intel_items and retire the actors table.
-- ----------------------------------------------------------------------------
-- Each intel item now carries its own motivation (nation_state / ecrime /
-- hacktivism) and country, so the dashboard can show a card per country plus a
-- "Non Attributed" card, instead of a fixed set of nexus buckets. The actors
-- nexus-card table and intel_items.actor_id FK are dropped; the timeline view
-- is rebuilt to read the new columns directly.
-- ============================================================================

alter table intel_items add column if not exists motivation text;
alter table intel_items add column if not exists country text;

-- Backfill: prefer the matched adversary's own classification...
update intel_items i
set motivation = adv.motivation[1],
    country = adv.country
from adversaries adv
where i.crowdstrike_adversary is not null
  and lower(adv.name) = lower(i.crowdstrike_adversary)
  and adv.motivation is not null;

-- ...then fall back to the actor nexus for anything still unclassified.
update intel_items i
set motivation = 'nation_state',
    country = case a.nexus
      when 'china'       then 'China'
      when 'russia'      then 'Russia'
      when 'north_korea' then 'North Korea'
      when 'iran'        then 'Iran'
      else null
    end
from actors a
where i.actor_id = a.id
  and i.motivation is null
  and a.nexus in ('china', 'russia', 'north_korea', 'iran', 'rest_of_world');

alter table intel_items drop constraint if exists intel_items_motivation_chk;
alter table intel_items
  add constraint intel_items_motivation_chk
  check (motivation is null or motivation in ('nation_state', 'ecrime', 'hacktivism'));

create index if not exists intel_items_country_idx on intel_items (country);

-- Rebuild the timeline view without the actors join, then drop actors + FK.
drop view if exists timeline_events;
alter table intel_items drop column if exists actor_id;
drop table if exists actors;

create view timeline_events
with (security_invoker = on)
as
select
  i.id,
  case
    when i.country in ('China', 'Russia', 'Iran', 'North Korea') then i.country
    else 'Rest of World'
  end as country,
  i.published_at,
  i.title,
  i.description,
  i.source_name,
  i.url
from intel_items i
where i.motivation = 'nation_state';

grant select on timeline_events to authenticated, service_role;
