-- ============================================================================
-- Audit log of candidates the ingest pipeline dropped (marketing, low-signal
-- crew mentions, LLM-rejected), so operators can review what was filtered out
-- and catch anything that should have been kept.
-- ============================================================================

create table if not exists dropped_items (
  id          uuid primary key default gen_random_uuid(),
  raw_hash    text not null unique,
  title       text not null,
  url         text,
  source_name text,
  reason      text,
  created_at  timestamptz not null default now()
);

create index if not exists dropped_items_created_at_idx
  on dropped_items (created_at desc);

alter table dropped_items enable row level security;

-- Read-only for any authenticated user; the pipeline writes via the service role.
create policy "read dropped_items" on dropped_items
  for select to authenticated using (public.is_allowed_user());

grant select on dropped_items to authenticated;
grant all on dropped_items to service_role;
