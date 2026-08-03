-- ============================================================================
-- Report subscriptions and their outbound email queue.
-- ----------------------------------------------------------------------------
-- A user subscribes to a label, an adversary or a country; when a report that
-- matches is ingested, relabelled or re-attributed, a row is queued here and a
-- digest is mailed at the end of the ingest run. The queue is the record of
-- what was sent, so a report is never mailed twice for the same reason.
-- ============================================================================

create type public.subscription_kind as enum ('label', 'adversary', 'country');

create table public.subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       public.subscription_kind not null,
  value      text not null,
  created_at timestamptz not null default now(),
  constraint subscriptions_value_not_blank check (length(btrim(value)) > 0)
);

-- One subscription per user per target, case-insensitively: "FANCY BEAR" and
-- "Fancy Bear" are the same actor.
create unique index subscriptions_user_kind_value_idx
  on public.subscriptions (user_id, kind, lower(value));
create index subscriptions_user_idx on public.subscriptions (user_id);

alter table public.subscriptions enable row level security;

create policy "subscriptions_select_own" on public.subscriptions
  for select to authenticated
  using (public.is_allowed_user() and auth.uid() = user_id);
create policy "subscriptions_insert_own" on public.subscriptions
  for insert to authenticated
  with check (public.is_allowed_user() and auth.uid() = user_id);
create policy "subscriptions_delete_own" on public.subscriptions
  for delete to authenticated
  using (public.is_allowed_user() and auth.uid() = user_id);

grant select, insert, delete on public.subscriptions to authenticated;
grant all privileges on public.subscriptions to service_role;

-- ----------------------------------------------------------------------------
-- Queue of notifications owed. Written by the ingest pipeline and by the
-- attribution/label edit actions; drained into digest emails by the dispatcher.
-- ----------------------------------------------------------------------------
create table public.notification_queue (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  intel_item_id uuid not null references public.intel_items (id) on delete cascade,
  -- Why this user is being told: which subscription matched.
  reason_kind   public.subscription_kind not null,
  reason_value  text not null,
  -- What happened to the report: 'ingest' | 'labels' | 'attribution'.
  trigger       text not null,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  -- Set when a send failed, so a stuck row is visible rather than silent.
  last_error    text
);

-- The same report for the same reason is only ever owed once. A later edit that
-- matches a *different* subscription is a genuinely new thing to say, so the
-- reason is part of the key.
create unique index notification_queue_unique_reason_idx
  on public.notification_queue (user_id, intel_item_id, reason_kind, lower(reason_value));
-- The dispatcher's read: everything still owed, oldest first.
create index notification_queue_pending_idx
  on public.notification_queue (user_id, created_at) where sent_at is null;

alter table public.notification_queue enable row level security;

-- Readable so a user can see their own pending/sent notifications; only the
-- service role writes, because queueing happens on behalf of the user during
-- ingest rather than from their own session.
create policy "notification_queue_select_own" on public.notification_queue
  for select to authenticated
  using (public.is_allowed_user() and auth.uid() = user_id);

grant select on public.notification_queue to authenticated;
grant all privileges on public.notification_queue to service_role;
