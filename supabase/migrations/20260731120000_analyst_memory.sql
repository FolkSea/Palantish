-- ============================================================================
-- Analyst agent memory: the persistent knowledge the triage/summary agent keeps
-- across ingest runs. Two kinds of note:
--   'adversary' - what the agent knows about a threat actor (aliases, tradecraft,
--                 targeting, recent activity), keyed by the actor's name;
--   'trend'     - a cross-report theme the agent is tracking, keyed by a slug.
-- Deduped case-insensitively per (kind, subject); `mentions` + `last_seen` give
-- salience/recency so the agent can compose a compact brief from the top notes.
-- ============================================================================
create table analyst_memory (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('adversary', 'trend')),
  subject    text not null,        -- actor name, or a short trend slug/title
  content    text not null,        -- the note itself (concise intelligence)
  mentions   integer not null default 1,
  last_seen  timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index analyst_memory_kind_subject_idx
  on analyst_memory (kind, lower(subject));
create index analyst_memory_last_seen_idx on analyst_memory (last_seen desc);
create trigger analyst_memory_updated_at before update on analyst_memory
  for each row execute function public.set_updated_at();

alter table analyst_memory enable row level security;
create policy "allowed read analyst_memory" on analyst_memory
  for select to authenticated using (public.is_allowed_user());
grant select on analyst_memory to authenticated;
grant all privileges on analyst_memory to service_role;
