-- ============================================================================
-- Unify reports into a single table keyed by `kind`.
-- ----------------------------------------------------------------------------
-- Breaches and vulnerabilities were separate tables, which made attribution
-- fragile (a row had to be moved between tables to be edited). Everything now
-- lives in intel_items with a `kind` discriminator:
--   research | breach | exploit | other
-- Sections read intel_items filtered by kind; attributing an item sets
-- kind='research' so it appears in the actor sections.
-- ============================================================================

alter table intel_items
  add column if not exists kind text not null default 'other',
  add column if not exists cve_id text,
  add column if not exists target text,
  add column if not exists exploit_status text,
  add column if not exists date_label text;

-- kind is the discriminator now; exploit/breach rows do not carry an item_type.
alter table intel_items alter column item_type drop not null;

alter table intel_items drop constraint if exists intel_items_kind_chk;
alter table intel_items
  add constraint intel_items_kind_chk
  check (kind in ('research', 'breach', 'exploit', 'other'));

-- Backfill existing intel rows: attributed / actor-activity reporting is
-- research, everything else is other.
update intel_items
set kind = case
  when motivation is not null
    or adversary_label is not null
    or crowdstrike_adversary is not null
    or item_type = 'actor_activity'
  then 'research'
  else 'other'
end
where kind = 'other';

-- Merge breaches -> intel_items (kind='breach').
insert into intel_items (
  raw_hash, title, description, url, published_at, kind,
  source_name, source_id, adversary_label, crowdstrike_adversary, date_label,
  confidence, item_type
)
select
  b.raw_hash, b.org_name, b.summary, b.url,
  coalesce(b.event_date, b.created_at::date), 'breach',
  b.source_name, b.source_id, b.adversary_label, b.crowdstrike_adversary,
  b.event_date_label, null, null
from breaches b
on conflict (raw_hash) do nothing;

-- Merge vulnerabilities -> intel_items (kind='exploit').
insert into intel_items (
  raw_hash, title, description, url, published_at, kind,
  source_name, source_id, cve_id, target, exploit_status, confidence, item_type
)
select
  v.raw_hash, v.cve_id, v.detail, v.url,
  v.added_at, 'exploit',
  v.source_name, v.source_id, v.cve_id, v.target, v.status::text, null, null
from vulnerabilities v
on conflict (raw_hash) do nothing;

create index if not exists intel_items_kind_idx on intel_items (kind);

-- Drop the now-redundant view + tables.
drop view if exists timeline_events;
drop table if exists breaches;
drop table if exists vulnerabilities;
