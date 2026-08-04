-- ============================================================================
-- In-app notifications: the bell beside the menu.
-- ----------------------------------------------------------------------------
-- One row per user per event, rather than one row per event with read receipts
-- alongside. An administrator broadcast is a handful of rows, and this keeps
-- both the policy ("your own") and "have I read it" trivially simple.
--
-- dedupe_key is what makes the guarantees real rather than hoped for: one
-- notification per ingest run, one per feed update, and exactly one "new user"
-- however many times that user signs in. The unique index enforces it, so a
-- retried run or a second sign-in is a no-op insert rather than a duplicate.
-- ============================================================================

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- subscription_match | feeds_ingested | feed_ingested | summary_updated
  -- | stale_feeds | suspect_iocs | ingest_errors | new_user
  kind       text not null,
  title      text not null,
  body       text,
  -- Where clicking it goes. Null means the notification is not actionable.
  href       text,
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  dedupe_key text not null,
  unique (user_id, dedupe_key)
);

-- The bell's own read: this user's newest first, unread counted.
create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

-- Strictly your own. Writing is the pipeline's job, via the service role, so
-- authenticated users get no insert - only the read and the marking-as-read.
create policy "notifications_select_own" on public.notifications
  for select to authenticated
  using (public.is_allowed_user() and auth.uid() = user_id);
create policy "notifications_update_own" on public.notifications
  for update to authenticated
  using (public.is_allowed_user() and auth.uid() = user_id)
  with check (public.is_allowed_user() and auth.uid() = user_id);
create policy "notifications_delete_own" on public.notifications
  for delete to authenticated
  using (public.is_allowed_user() and auth.uid() = user_id);

grant select, update, delete on public.notifications to authenticated;
grant all privileges on public.notifications to service_role;
