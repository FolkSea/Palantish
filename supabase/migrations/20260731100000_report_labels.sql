-- ============================================================================
-- User-defined labels: free-form tags an analyst attaches to a report from the
-- modal. Labels are deduped by name (case-insensitively) in their own table and
-- linked many-to-many to the report items (intel_items) they tag.
-- ============================================================================
create table labels (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,        -- display text, as first entered (trimmed)
  created_at timestamptz not null default now()
);
-- Dedup case-insensitively so "Malware" and "malware" are the same label.
create unique index labels_name_lower_idx on labels (lower(name));

-- many-to-many: report item <-> label
create table intel_item_labels (
  intel_item_id uuid not null references intel_items (id) on delete cascade,
  label_id      uuid not null references labels (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (intel_item_id, label_id)
);
create index intel_item_labels_label_id_idx on intel_item_labels (label_id);

alter table labels enable row level security;
create policy "allowed read labels" on labels
  for select to authenticated using (public.is_allowed_user());
grant select on labels to authenticated;
grant all privileges on labels to service_role;

alter table intel_item_labels enable row level security;
create policy "allowed read intel_item_labels" on intel_item_labels
  for select to authenticated using (public.is_allowed_user());
grant select on intel_item_labels to authenticated;
grant all privileges on intel_item_labels to service_role;
