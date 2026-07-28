-- ============================================================================
-- Actor families: maps a CrowdStrike animal to a focus (eCrime / Nation State /
-- Hacktivism) and, for nation-state animals, a country. Externalises the
-- animal -> focus/country logic so operators can manage it from settings.
-- ============================================================================
create table actor_families (
  id         uuid primary key default gen_random_uuid(),
  animal     text not null unique,
  focus      text not null, -- 'ecrime' | 'nation_state' | 'hacktivism'
  country    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table actor_families enable row level security;

create policy "allowed read actor_families" on actor_families
  for select to authenticated using (public.is_allowed_user());

grant select on actor_families to authenticated;
grant all privileges on actor_families to service_role;

insert into actor_families (animal, focus, country) values
  ('Spider',   'ecrime',       null),
  ('Jackal',   'hacktivism',   null),
  ('Panda',    'nation_state', 'China'),
  ('Bear',     'nation_state', 'Russia'),
  ('Chollima', 'nation_state', 'North Korea'),
  ('Kitten',   'nation_state', 'Iran'),
  ('Bat',      'nation_state', null),
  ('Tiger',    'nation_state', 'India'),
  ('Wolf',     'nation_state', 'Turkey'),
  ('Buffalo',  'nation_state', 'Vietnam'),
  ('Leopard',  'nation_state', 'Pakistan')
on conflict (animal) do nothing;
