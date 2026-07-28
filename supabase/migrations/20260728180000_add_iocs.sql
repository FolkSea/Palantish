-- ============================================================================
-- IOCs: indicators of compromise deduped by value, with a many-to-many link to
-- the report items (intel_items) they were observed in. One IOC row per unique
-- value; the join table records which reports reference it.
-- ============================================================================
create table iocs (
  id         uuid primary key default gen_random_uuid(),
  value      text not null unique,   -- dedup key (e.g. an IP, domain, URI or file hash)
  ioc_type   text not null,          -- 'ip' | 'domain' | 'uri' | 'file_hash'
  comment    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint iocs_type_check check (ioc_type in ('ip', 'domain', 'uri', 'file_hash'))
);
create index iocs_ioc_type_idx on iocs (ioc_type);
create trigger iocs_updated_at before update on iocs
  for each row execute function public.set_updated_at();

-- many-to-many: report item <-> IOC
create table intel_item_iocs (
  intel_item_id uuid not null references intel_items (id) on delete cascade,
  ioc_id        uuid not null references iocs (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (intel_item_id, ioc_id)
);
create index intel_item_iocs_ioc_id_idx on intel_item_iocs (ioc_id);

alter table iocs enable row level security;
create policy "allowed read iocs" on iocs
  for select to authenticated using (public.is_allowed_user());
grant select on iocs to authenticated;
grant all privileges on iocs to service_role;

alter table intel_item_iocs enable row level security;
create policy "allowed read intel_item_iocs" on intel_item_iocs
  for select to authenticated using (public.is_allowed_user());
grant select on intel_item_iocs to authenticated;
grant all privileges on intel_item_iocs to service_role;
