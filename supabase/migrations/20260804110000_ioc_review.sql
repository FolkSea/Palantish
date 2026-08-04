-- ============================================================================
-- Daily indicator review: indicators the model thinks are not really IOCs.
-- ----------------------------------------------------------------------------
-- Extraction mistakes and publisher noise do not just add clutter - an
-- indicator held by several reports joins them in the link graph, so a vendor
-- advisory URL or a version number misread as an IP invents relationships that
-- were never there. Those are hard to notice by reading one report at a time,
-- which is what makes them worth a pass over the whole corpus.
--
-- A flag is a suggestion, never an action: the review only ever writes rows
-- here, and an administrator decides. Resolving one records which way it went,
-- so a value judged legitimate is not raised again next time.
-- ============================================================================

create table public.ioc_review_flags (
  id          uuid primary key default gen_random_uuid(),
  -- Null once the indicator has been deleted - which is the usual end of an
  -- accepted flag, and exactly when the record of the decision matters most.
  -- Cascading here would erase the audit trail at the moment it is created.
  ioc_id      uuid references public.iocs (id) on delete set null,
  -- Kept alongside the id so a resolved flag still reads after the indicator
  -- itself is gone. Postgres allows repeated nulls under a unique constraint,
  -- so several removed flags coexist.
  value       text not null,
  ioc_type    text not null,
  category    text not null,
  reason      text not null,
  -- Reports referencing it when flagged: the size of the problem, and why this
  -- one was worth a look.
  reports     integer not null default 0,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  -- "removed" - the indicator was deleted; "kept" - judged a real indicator.
  resolution  text check (resolution in ('removed', 'kept')),
  unique (ioc_id)
);

-- The panel's own read: open flags, worst first.
create index ioc_review_flags_open_idx
  on public.ioc_review_flags (resolved_at, reports desc);

-- Each pass, so the review can be skipped when one has already run today and
-- an administrator can see it is actually running.
create table public.ioc_review_runs (
  id         uuid primary key default gen_random_uuid(),
  ran_at     timestamptz not null default now(),
  candidates integer not null default 0,
  flagged    integer not null default 0,
  model      text,
  error      text
);

create index ioc_review_runs_ran_at_idx on public.ioc_review_runs (ran_at desc);

alter table public.ioc_review_flags enable row level security;
alter table public.ioc_review_runs enable row level security;

-- Administrators only, on both: these are judgements about the corpus, and the
-- only actions on them (delete an indicator, or bless it) are administrative.
create policy "administrators read ioc_review_flags" on public.ioc_review_flags
  for select to authenticated using (public.is_administrator());
create policy "administrators update ioc_review_flags" on public.ioc_review_flags
  for update to authenticated using (public.is_administrator())
  with check (public.is_administrator());

create policy "administrators read ioc_review_runs" on public.ioc_review_runs
  for select to authenticated using (public.is_administrator());

-- Writing flags is the pipeline's job, so authenticated users get no insert.
grant select, update on public.ioc_review_flags to authenticated;
grant select on public.ioc_review_runs to authenticated;
grant all privileges on public.ioc_review_flags to service_role;
grant all privileges on public.ioc_review_runs to service_role;
