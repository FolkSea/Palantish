-- ============================================================================
-- Nation-State Cyber Intelligence Dashboard - initial schema
-- ============================================================================
-- Design notes:
--   * uuid PKs (gen_random_uuid), created_at/updated_at on mutable tables.
--   * RLS enabled everywhere. Authenticated + allow-listed users may SELECT the
--     intel tables. No client INSERT/UPDATE/DELETE policies exist, so only the
--     service-role key (used by the ingest pipeline, bypasses RLS) can write.
--   * The allow-list is enforced in the database via public.is_allowed_user(),
--     independent of the middleware allow-list, as defense in depth.
-- ============================================================================

-- Enums -----------------------------------------------------------------------
create type source_category  as enum ('vendor', 'research', 'news', 'government');
create type actor_nexus      as enum ('china', 'russia', 'north_korea', 'iran', 'other');
create type actor_status     as enum ('active', 'quiet');
create type confidence_level as enum ('confirmed', 'suspected', 'poc');
create type item_type        as enum ('actor_activity', 'breach', 'vuln', 'report', 'breaking');
create type vuln_status      as enum ('confirmed', 'poc', 'suspected');
create type refresh_status   as enum ('running', 'success', 'error');

-- updated_at trigger helper ---------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- allow-list ------------------------------------------------------------------
create table allowed_users (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);

create or replace function public.is_allowed_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.allowed_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- sources ---------------------------------------------------------------------
create table sources (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  url        text,
  category   source_category not null,
  feed_url   text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger sources_updated_at before update on sources
  for each row execute function public.set_updated_at();

-- actors ----------------------------------------------------------------------
create table actors (
  id             uuid primary key default gen_random_uuid(),
  nexus          actor_nexus not null,
  display_name   text not null,
  tracked_groups text,
  status         actor_status not null default 'active',
  note           text,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index actors_nexus_key on actors (nexus);
create trigger actors_updated_at before update on actors
  for each row execute function public.set_updated_at();

-- intel_items -----------------------------------------------------------------
create table intel_items (
  id                    uuid primary key default gen_random_uuid(),
  actor_id              uuid references actors (id) on delete set null,
  title                 text not null,
  description           text,
  url                   text,
  published_at          date not null,          -- report/advisory publication date, NOT ingestion date
  confidence            confidence_level,
  crowdstrike_adversary text,
  source_name           text,
  source_id             uuid references sources (id) on delete set null,
  item_type             item_type not null,
  raw_hash              text not null unique,    -- dedup key: hash(title + url)
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index intel_items_published_at_idx on intel_items (published_at desc);
create index intel_items_item_type_idx    on intel_items (item_type);
create index intel_items_actor_id_idx     on intel_items (actor_id);
create trigger intel_items_updated_at before update on intel_items
  for each row execute function public.set_updated_at();

-- vulnerabilities -------------------------------------------------------------
create table vulnerabilities (
  id          uuid primary key default gen_random_uuid(),
  cve_id      text not null,
  target      text,
  status      vuln_status not null,
  detail      text,
  url         text,
  source_name text,
  source_id   uuid references sources (id) on delete set null,
  raw_hash    text not null unique,
  added_at    date not null default current_date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index vulnerabilities_added_at_idx on vulnerabilities (added_at desc);
create trigger vulnerabilities_updated_at before update on vulnerabilities
  for each row execute function public.set_updated_at();

-- breaches --------------------------------------------------------------------
create table breaches (
  id               uuid primary key default gen_random_uuid(),
  org_name         text not null,
  event_date_label text,                        -- human label, e.g. "July 2026"
  event_date       date,                        -- sortable date when known
  summary          text,
  source_name      text,
  source_id        uuid references sources (id) on delete set null,
  url              text,
  raw_hash         text not null unique,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index breaches_event_date_idx on breaches (event_date desc nulls last);
create trigger breaches_updated_at before update on breaches
  for each row execute function public.set_updated_at();

-- refresh_runs ----------------------------------------------------------------
create table refresh_runs (
  id            uuid primary key default gen_random_uuid(),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  items_added   int not null default 0,
  items_updated int not null default 0,
  status        refresh_status not null default 'running',
  log           text
);
create index refresh_runs_started_at_idx on refresh_runs (started_at desc);

-- timeline_events -------------------------------------------------------------
-- A view over intel_items for the four nation-states, last 30 days. Uses
-- security_invoker so the querying user's RLS on intel_items/actors applies.
create view timeline_events
with (security_invoker = on)
as
select
  i.id,
  case a.nexus
    when 'china'       then 'China'
    when 'russia'      then 'Russia'
    when 'iran'        then 'Iran'
    when 'north_korea' then 'North Korea'
  end               as country,
  i.published_at,
  i.title,
  i.description,
  i.source_name,
  i.url
from intel_items i
join actors a on a.id = i.actor_id
where a.nexus in ('china', 'russia', 'iran', 'north_korea')
  and i.published_at >= current_date - interval '30 days';

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table allowed_users   enable row level security;
alter table sources         enable row level security;
alter table actors          enable row level security;
alter table intel_items     enable row level security;
alter table vulnerabilities enable row level security;
alter table breaches        enable row level security;
alter table refresh_runs    enable row level security;

-- allowed_users: no client access at all (managed by service role only).
-- is_allowed_user() reads it via SECURITY DEFINER, so no client policy needed.

-- Read-only access for authenticated, allow-listed users on the intel tables.
create policy "allowed read sources"         on sources
  for select to authenticated using (public.is_allowed_user());
create policy "allowed read actors"          on actors
  for select to authenticated using (public.is_allowed_user());
create policy "allowed read intel_items"     on intel_items
  for select to authenticated using (public.is_allowed_user());
create policy "allowed read vulnerabilities" on vulnerabilities
  for select to authenticated using (public.is_allowed_user());
create policy "allowed read breaches"        on breaches
  for select to authenticated using (public.is_allowed_user());
create policy "allowed read refresh_runs"    on refresh_runs
  for select to authenticated using (public.is_allowed_user());

-- No INSERT/UPDATE/DELETE policies => all client writes are denied by RLS.
-- The ingest pipeline uses the service-role key, which bypasses RLS.

-- ============================================================================
-- Grants
-- ============================================================================
-- RLS decides which rows a role may see, but the role still needs a table-level
-- GRANT. Authenticated users get SELECT on the intel tables (rows further
-- filtered by the allow-list policies above); the service role gets full access
-- for the ingest pipeline. allowed_users is intentionally NOT granted to
-- authenticated, so the allow-list is never client-readable.
grant usage on schema public to anon, authenticated, service_role;

grant select on
  sources, actors, intel_items, vulnerabilities, breaches, refresh_runs,
  timeline_events
to authenticated;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;
