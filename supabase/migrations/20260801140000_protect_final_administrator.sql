-- Prevent every write path (including direct service-role operations) from
-- removing the final Administrator. The transaction lock serialises concurrent
-- demotions so two admins cannot both pass the check at the same time.
create or replace function public.protect_final_administrator()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  removing_administrator boolean := false;
begin
  if old.role = 'administrator' then
    if tg_op = 'DELETE' then
      removing_administrator := true;
    elsif new.role <> 'administrator' then
      removing_administrator := true;
    end if;
  end if;

  if removing_administrator then
    perform pg_advisory_xact_lock(hashtext('palantish-final-administrator'));
    if not exists (
      select 1
      from public.account_roles
      where role = 'administrator'
        and user_id <> old.user_id
    ) then
      raise exception 'The final Administrator cannot be removed.';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger protect_final_administrator_before_write
  before update or delete on public.account_roles
  for each row execute function public.protect_final_administrator();

revoke all on function public.protect_final_administrator() from public;
