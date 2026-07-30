-- ============================================================================
-- Manage access purely via Supabase Auth.
-- ----------------------------------------------------------------------------
-- Drop the application-level email allow-list. Every RLS read policy is defined
-- as `to authenticated using (public.is_allowed_user())`; redefining that
-- function to "is this an authenticated user" admits any user that exists in
-- Supabase Auth, without rewriting the individual policies. Who may sign in is
-- now controlled entirely in Supabase Auth (invite-only; keep public sign-ups
-- disabled in the Auth settings). The allowed_users table is left in place but
-- is no longer consulted.
-- ============================================================================

create or replace function public.is_allowed_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.role() = 'authenticated', false);
$$;
