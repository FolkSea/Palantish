-- ============================================================================
-- Personal reading list: reports an analyst is currently working on.
-- ----------------------------------------------------------------------------
-- Per-user and private, like hidden_items. Keyed on the report's id rather than
-- its raw_hash so a bookmark follows the row and disappears with it.
-- ============================================================================

create table public.bookmarks (
  user_id       uuid not null references auth.users (id) on delete cascade,
  intel_item_id uuid not null references public.intel_items (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, intel_item_id)
);

-- The list's own read: one user's bookmarks, most recently added first.
create index bookmarks_user_created_idx
  on public.bookmarks (user_id, created_at desc);

alter table public.bookmarks enable row level security;

create policy "bookmarks_select_own" on public.bookmarks
  for select to authenticated
  using (public.is_allowed_user() and auth.uid() = user_id);
create policy "bookmarks_insert_own" on public.bookmarks
  for insert to authenticated
  with check (public.is_allowed_user() and auth.uid() = user_id);
create policy "bookmarks_delete_own" on public.bookmarks
  for delete to authenticated
  using (public.is_allowed_user() and auth.uid() = user_id);

grant select, insert, delete on public.bookmarks to authenticated;
grant all privileges on public.bookmarks to service_role;
