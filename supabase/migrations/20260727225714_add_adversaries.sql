-- ============================================================================
-- CrowdStrike adversary catalogue
-- ============================================================================
-- Reference data loaded from adversaries.json (see `pnpm load:adversaries`).
-- Used by the ingest pipeline to map adversary aliases found in reports to their
-- CrowdStrike cryptonym and nation-state nexus. Read-only for the dashboard.
-- ============================================================================

create table adversaries (
  id                         uuid primary key default gen_random_uuid(),
  cs_id                      text unique,                 -- e.g. "Adversary:cozybear"
  name                       text not null,               -- CrowdStrike cryptonym
  animal_classifier          text,                        -- PANDA / BEAR / KITTEN / ...
  nexus                      actor_nexus not null default 'other',
  status                     text,                        -- Active / Inactive / Retired
  description                text,
  short_description          text,
  first_seen                 timestamptz,
  last_seen                  timestamptz,
  objectives                 text[],
  motivation                 text[],
  targeting_profile          text[],
  community_identifiers      text[],                      -- public / other-vendor names
  internal_alternative_names text[],
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create index adversaries_nexus_idx  on adversaries (nexus);
create index adversaries_name_idx   on adversaries (name);
create index adversaries_animal_idx on adversaries (animal_classifier);

create trigger adversaries_updated_at before update on adversaries
  for each row execute function public.set_updated_at();

-- RLS: read-only for authenticated allow-listed users; writes via service role.
alter table adversaries enable row level security;

create policy "allowed read adversaries" on adversaries
  for select to authenticated using (public.is_allowed_user());

grant select on adversaries to authenticated;
grant all privileges on adversaries to service_role;
