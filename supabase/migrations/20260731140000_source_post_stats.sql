-- ============================================================================
-- Per-feed ingest stats: cumulative counts of how many pulled posts each source
-- has had kept (classified as intelligence and stored) vs dropped (marketing,
-- low-signal crew mentions, or LLM-rejected). Shows which feeds earn their noise.
-- ============================================================================
alter table sources
  add column if not exists posts_kept    integer not null default 0,
  add column if not exists posts_dropped integer not null default 0;

-- Atomically add an ingest run's per-feed tallies, so overlapping runs (a manual
-- refresh during a cron run) never lose increments. `stats` is a JSON array of
-- { id, kept, dropped }.
create or replace function public.bump_source_stats(stats jsonb)
returns void
language sql
as $$
  update sources s
  set posts_kept    = s.posts_kept    + coalesce((e.value->>'kept')::int, 0),
      posts_dropped = s.posts_dropped + coalesce((e.value->>'dropped')::int, 0)
  from jsonb_array_elements(stats) e
  where s.id = (e.value->>'id')::uuid;
$$;

grant execute on function public.bump_source_stats(jsonb) to service_role;
