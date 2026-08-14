-- ============================================================================
-- Take the owner's address out of the account-role trigger.
-- ----------------------------------------------------------------------------
-- The first administrator was promoted by matching a hardcoded email when
-- account_roles was created. That worked, and then stayed - in this repository,
-- which is public, and in the database, where the function body still carried
-- it. This redefines the function so neither does.
--
-- Nothing about who is an administrator changes. Roles are rows, and this only
-- touches the function that assigns one at signup; every existing row, the
-- owner's included, is left exactly as it is.
--
-- The address kept here is the one pnpm dev:login signs in as, so a freshly
-- reset local database still has an administrator without anybody promoting a
-- row by hand. It is not an address anybody can sign up as in production:
-- accounts there are created by invitation, and the invitation has to be sent
-- by an administrator who already exists.
-- ============================================================================

create or replace function public.create_default_account_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.account_roles (user_id, role)
  values (
    new.id,
    case
      when lower(new.email) = 'ccdev@local.test'
        then 'administrator'::public.account_role
      else 'user'::public.account_role
    end
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.create_default_account_role() from public;
