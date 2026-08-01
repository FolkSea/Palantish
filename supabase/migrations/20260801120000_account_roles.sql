-- Account security levels. Existing accounts default to User; the initial
-- Administrator is promoted explicitly below.
create type public.account_role as enum ('administrator', 'user');

create table public.account_roles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       public.account_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger account_roles_updated_at before update on public.account_roles
  for each row execute function public.set_updated_at();

-- Every new account starts at the least-privileged level. Role promotion is an
-- administrative database operation; users cannot update their own role.
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
      when lower(new.email) = 'andydove71@gmail.com'
        then 'administrator'::public.account_role
      else 'user'::public.account_role
    end
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger create_account_role_after_signup
  after insert on auth.users
  for each row execute function public.create_default_account_role();

revoke all on function public.create_default_account_role() from public;

insert into public.account_roles (user_id, role)
select id, 'user'::public.account_role
from auth.users
on conflict (user_id) do nothing;

insert into public.account_roles (user_id, role)
select id, 'administrator'::public.account_role
from auth.users
where lower(email) = 'andydove71@gmail.com'
on conflict (user_id) do update
set role = excluded.role;

alter table public.account_roles enable row level security;

create policy "users read own account role" on public.account_roles
  for select to authenticated
  using (user_id = auth.uid());

grant select on public.account_roles to authenticated;
grant all privileges on public.account_roles to service_role;

create or replace function public.is_administrator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.account_roles
    where user_id = auth.uid()
      and role = 'administrator'
  );
$$;

revoke all on function public.is_administrator() from public;
grant execute on function public.is_administrator() to authenticated, service_role;

-- Memory and dropped-post audit data are administrator-only even when queried
-- directly through Supabase rather than through the Settings page.
drop policy if exists "read dropped_items" on public.dropped_items;
create policy "administrators read dropped_items" on public.dropped_items
  for select to authenticated using (public.is_administrator());

drop policy if exists "allowed read analyst_memory" on public.analyst_memory;
create policy "administrators read analyst_memory" on public.analyst_memory
  for select to authenticated using (public.is_administrator());
