-- ============================================================================
-- Make the sign-in allow-list mean something again.
-- ----------------------------------------------------------------------------
-- is_allowed_user() has read `auth.role() = 'authenticated'` since
-- 20260730140000 - that is, "anyone with an account". Every "allowed read X"
-- policy has therefore been open to any account, and the app performs no email
-- check of its own at sign-in, so eligibility rested entirely on whether signup
-- happened to be disabled in the Supabase project. That is one dashboard toggle
-- between a private intelligence corpus and the public.
--
-- This restores the table check. It matters at the database rather than in the
-- application because a signed-in user holds a JWT and can query PostgREST
-- directly with the anon key - a check in the Next app would not be in that
-- path at all.
--
-- Existing accounts are grandfathered in below. The allow-list had gone stale
-- while unused (it listed two addresses, neither of them an account that
-- actually existed), so flipping the function without seeding it first would
-- have locked out every current user, including the last administrator.
-- ============================================================================

-- Grandfather everyone who already has an account. Nobody working today loses
-- access; the gate applies to accounts created from here on.
insert into public.allowed_users (email, note)
select lower(u.email), 'grandfathered when the allow-list was restored'
from auth.users u
where u.email is not null
on conflict (email) do nothing;

-- Emails are compared case-insensitively, so store and match in lower case.
update public.allowed_users set email = lower(email) where email <> lower(email);

create index if not exists allowed_users_email_lower_idx
  on public.allowed_users (lower(email));

create or replace function public.is_allowed_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.allowed_users a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

comment on function public.is_allowed_user() is
  'True when the caller''s email is on the allow-list. Used by every read policy; the service role bypasses RLS and is unaffected.';

revoke all on function public.is_allowed_user() from public;
grant execute on function public.is_allowed_user() to authenticated, service_role;
