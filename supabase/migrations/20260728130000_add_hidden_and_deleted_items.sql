-- ============================================================================
-- Per-user hidden items and a global deleted-items blocklist.
--   * deleted_items: content hashes removed from the dashboard that the ingest
--     pipeline must never re-import. Service-role only (written by server
--     actions via the service key); never exposed to clients.
--   * hidden_items: rows a single user has hidden. Row-level security scopes
--     every operation to the owning, allow-listed user.
-- ============================================================================

-- Global delete blocklist ----------------------------------------------------
create table deleted_items (
  raw_hash    text primary key,
  url         text,
  title       text,
  deleted_by  uuid references auth.users (id) on delete set null,
  deleted_at  timestamptz not null default now()
);

alter table deleted_items enable row level security;
-- No client policies: only the service role (server actions) reads/writes.
grant all privileges on deleted_items to service_role;

-- Per-user hidden items ------------------------------------------------------
create table hidden_items (
  user_id    uuid not null references auth.users (id) on delete cascade,
  raw_hash   text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, raw_hash)
);

create index hidden_items_user_idx on hidden_items (user_id);

alter table hidden_items enable row level security;

-- Allow-listed users manage only their own hidden rows.
create policy "hidden_items_select_own" on hidden_items
  for select to authenticated
  using (public.is_allowed_user() and auth.uid() = user_id);
create policy "hidden_items_insert_own" on hidden_items
  for insert to authenticated
  with check (public.is_allowed_user() and auth.uid() = user_id);
create policy "hidden_items_delete_own" on hidden_items
  for delete to authenticated
  using (public.is_allowed_user() and auth.uid() = user_id);

grant select, insert, delete on hidden_items to authenticated;
grant all privileges on hidden_items to service_role;
