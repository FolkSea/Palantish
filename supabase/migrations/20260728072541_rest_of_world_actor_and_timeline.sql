-- Rest-of-the-World actor card + timeline coverage for the new nexus.

insert into actors (nexus, display_name, tracked_groups, status, sort_order) values
  ('rest_of_world', 'Rest of the World',
   'Other state-nexus clusters (e.g. India, Vietnam, Turkey, Pakistan, and unattributed state actors)',
   'quiet', 5)
on conflict (nexus) do nothing;

-- Recreate the timeline view to include rest_of_world as a fifth series.
drop view if exists timeline_events;
create view timeline_events
with (security_invoker = on)
as
select
  i.id,
  case a.nexus
    when 'china'         then 'China'
    when 'russia'        then 'Russia'
    when 'iran'          then 'Iran'
    when 'north_korea'   then 'North Korea'
    when 'rest_of_world' then 'Rest of World'
  end               as country,
  i.published_at,
  i.title,
  i.description,
  i.source_name,
  i.url
from intel_items i
join actors a on a.id = i.actor_id
where a.nexus in ('china', 'russia', 'iran', 'north_korea', 'rest_of_world')
  and i.published_at >= current_date - interval '30 days';

grant select on timeline_events to authenticated;
