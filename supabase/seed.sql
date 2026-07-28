-- ============================================================================
-- Seed data. Runs on `supabase start` and `supabase db reset`.
-- ============================================================================
-- This file currently seeds only infrastructure (the access allow-list and the
-- RSS source catalogue). The dashboard intel dataset (actors, intel_items,
-- vulnerabilities, breaches) is appended below once confirmed.
-- ============================================================================

-- Access allow-list ----------------------------------------------------------
insert into allowed_users (email, note) values
  ('andrew.m.dove@gmail.com', 'owner')
on conflict (email) do nothing;

-- Actors (the nexus cards) ---------------------------------------------------
-- Structural reference data for the "activity by actor" section. The entries
-- (intel_items) inside each card are populated by the ingest pipeline from real
-- feeds, not seeded here.
insert into actors (nexus, display_name, tracked_groups, status, sort_order) values
  ('china',       'China',        'Volt Typhoon, Salt Typhoon, APT41, Mustang Panda, APT31',        'quiet', 1),
  ('russia',      'Russia',       'APT28/Fancy Bear, APT29/Cozy Bear, Sandworm, Turla, Gamaredon',  'quiet', 2),
  ('north_korea', 'North Korea',  'Lazarus, APT38, Kimsuky, Andariel, BlueNoroff',                  'quiet', 3),
  ('iran',        'Iran',         'APT35/Charming Kitten, MuddyWater, APT34/OilRig, APT33',          'quiet', 4),
  ('other',       'Rest of world / other clusters', 'Large-scale eCrime: LockBit, ALPHV/BlackCat, Scattered Spider, Cl0p', 'quiet', 5)
on conflict (nexus) do nothing;

-- RSS / source catalogue -----------------------------------------------------
insert into sources (name, url, category, feed_url) values
  ('Microsoft Threat Intelligence', 'https://www.microsoft.com/en-us/security/blog/', 'research', 'https://www.microsoft.com/en-us/security/blog/feed/atom/'),
  ('Microsoft MSRC',          'https://msrc.microsoft.com/update-guide/',        'vendor',     'https://api.msrc.microsoft.com/update-guide/rss'),
  ('CrowdStrike',             'https://www.crowdstrike.com/en-us/blog/',         'vendor',     'https://www.crowdstrike.com/en-us/blog/feed'),
  ('SentinelLabs',            'https://www.sentinelone.com/labs/',               'research',   'https://www.sentinelone.com/labs/feed/'),
  ('Kaspersky Securelist',    'https://securelist.com/',                         'research',   'https://securelist.com/feed/'),
  ('Unit 42',                 'https://unit42.paloaltonetworks.com/',            'research',   'https://unit42.paloaltonetworks.com/feed/'),
  ('Google Threat Intelligence', 'https://cloud.google.com/blog/topics/threat-intelligence/', 'research', 'https://feeds.feedburner.com/threatintelligence/pvexyqv7v0v'),
  ('Cisco Talos',             'https://blog.talosintelligence.com/',             'research',   'https://blog.talosintelligence.com/rss/'),
  ('Zero Day Initiative',     'https://www.thezdi.com/blog',                     'research',   'https://www.thezdi.com/blog?format=rss'),
  ('Malwarebytes Labs',       'https://www.malwarebytes.com/blog',               'research',   'https://www.malwarebytes.com/blog/feed/index.xml'),
  ('Proofpoint',              'https://www.proofpoint.com/us',                   'vendor',     'https://www.proofpoint.com/us/rss.xml'),
  ('Krebs on Security',       'https://krebsonsecurity.com/',                    'news',       'https://krebsonsecurity.com/feed/'),
  ('The Hacker News',         'https://thehackernews.com/',                      'news',       'https://feeds.feedburner.com/TheHackersNews?format=xml'),
  ('BleepingComputer',        'https://www.bleepingcomputer.com/',               'news',       'https://www.bleepingcomputer.com/feed'),
  ('The Record',              'https://therecord.media/',                        'news',       'https://therecord.media/feed'),
  ('SANS ISC',                'https://isc.sans.edu/',                           'news',       'https://isc.sans.edu/rssfeed.xml'),
  ('CISA',                    'https://www.cisa.gov/news-events/cybersecurity-advisories', 'government', 'https://www.cisa.gov/cybersecurity-advisories/all.xml'),
  ('CERT-UA',                 'https://cert.gov.ua/',                            'government', null),
  ('NCSC',                    'https://www.ncsc.gov.uk/',                        'government', null),
  ('Group-IB',                'https://www.group-ib.com/blog/',                  'research',   null),
  ('TRM Labs',                'https://www.trmlabs.com/insights',                'research',   null),
  ('Hunt.io',                 'https://hunt.io/blog',                            'research',   null)
on conflict (name) do nothing;
