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

-- RSS / source catalogue -----------------------------------------------------
insert into sources (name, url, category, feed_url) values
  ('Microsoft Security Blog', 'https://www.microsoft.com/en-us/security/blog/', 'vendor',     'https://www.microsoft.com/en-us/security/blog/feed/'),
  ('Microsoft MSRC',          'https://msrc.microsoft.com/blog/',                'vendor',     'https://msrc.microsoft.com/blog/rss/'),
  ('CrowdStrike',             'https://www.crowdstrike.com/en-us/blog/',         'vendor',     'https://www.crowdstrike.com/en-us/blog/feed'),
  ('SentinelLabs',            'https://www.sentinelone.com/labs/',               'research',   'https://www.sentinelone.com/labs/feed/'),
  ('Kaspersky Securelist',    'https://securelist.com/',                         'research',   'https://securelist.com/feed/'),
  ('Unit 42',                 'https://unit42.paloaltonetworks.com/',            'research',   'https://unit42.paloaltonetworks.com/feed/'),
  ('Google Project Zero',     'https://googleprojectzero.blogspot.com/',         'research',   'https://googleprojectzero.blogspot.com/feeds/posts/default'),
  ('Google Online Security',  'https://security.googleblog.com/',                'vendor',     'http://feeds.feedburner.com/GoogleOnlineSecurityBlog'),
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
