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

-- Nation-state activity is grouped per country, derived from each intel item's
-- own motivation + country (attributed by the ingest); there is no separate
-- actors table to seed.

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
  ('NCSC',                    'https://www.ncsc.gov.uk/',                        'government', 'https://www.ncsc.gov.uk/api/1/services/v1/news-rss-feed.xml'),
  ('Group-IB',                'https://www.group-ib.com/blog/',                  'research',   null),
  ('TRM Labs',                'https://www.trmlabs.com/insights',                'research',   null),
  ('Hunt.io',                 'https://hunt.io/blog',                            'research',   null),
  -- Merged from ThreatFilter OPML (currency-verified live RSS feeds) ----------
  ('CERT-EU',                 'https://cert.europa.eu/publications/security-advisories', 'government', 'https://cert.europa.eu/publications/security-advisories-rss'),
  ('CERT-FR Alertes',         'https://www.cert.ssi.gouv.fr/alerte/',            'government', 'https://www.cert.ssi.gouv.fr/alerte/feed/'),
  ('CERT-FR Avis',            'https://www.cert.ssi.gouv.fr/avis/',              'government', 'https://www.cert.ssi.gouv.fr/avis/feed/'),
  ('CISA Current Activity',   'https://www.cisa.gov/news-events/cybersecurity-advisories', 'government', 'https://us-cert.cisa.gov/ncas/current-activity.xml'),
  ('CISA News',               'https://www.cisa.gov/news-events/news',           'government', 'https://www.cisa.gov/news.xml'),
  ('CISA Blog',               'https://www.cisa.gov/news-events/cisa-blog',      'government', 'https://www.cisa.gov/blog.xml'),
  ('JPCERT/CC',               'https://www.jpcert.or.jp/english/',               'government', 'https://www.jpcert.or.jp/english/rss/jpcert-en.rdf'),
  ('GitLab Security Releases','https://about.gitlab.com/releases/',              'vendor',     'https://about.gitlab.com/security-releases.xml'),
  ('Huntress',                'https://www.huntress.com/blog',                   'vendor',     'https://www.huntress.com/blog/rss.xml'),
  ('Cisco PSIRT',             'https://sec.cloudapps.cisco.com/security/center/publicationListing.x', 'vendor', 'https://sec.cloudapps.cisco.com/security/center/psirtrss20/CiscoSecurityAdvisory.xml'),
  ('Fortinet PSIRT',          'https://www.fortiguard.com/psirt',                'vendor',     'https://www.fortiguard.com/rss/ir.xml'),
  ('Palo Alto Networks PSIRT','https://security.paloaltonetworks.com/',          'vendor',     'https://security.paloaltonetworks.com/rss.xml'),
  ('Apple Security Releases', 'https://developer.apple.com/news/releases/',      'vendor',     'https://developer.apple.com/news/releases/rss/releases.rss'),
  ('Splunk Security Advisories','https://advisory.splunk.com/',                  'vendor',     'https://advisory.splunk.com/feed.xml'),
  ('Check Point Research',    'https://research.checkpoint.com/',                'research',   'https://research.checkpoint.com/feed/'),
  ('Dark Reading',            'https://www.darkreading.com/',                    'news',       'https://www.darkreading.com/rss.xml'),
  ('ESET WeLiveSecurity',     'https://www.welivesecurity.com/',                 'research',   'https://www.welivesecurity.com/en/rss/feed/'),
  ('GreyNoise Labs',          'https://www.greynoise.io/blog',                   'research',   'https://www.greynoise.io/blog/rss.xml'),
  ('Mandiant',                'https://cloud.google.com/blog/topics/threat-intelligence', 'research', 'https://cloudblog.withgoogle.com/topics/threat-intelligence/rss/'),
  ('Schneier on Security',    'https://www.schneier.com/',                       'news',       'https://www.schneier.com/feed/atom/'),
  ('SecurityWeek',            'https://www.securityweek.com/',                   'news',       'https://www.securityweek.com/feed/'),
  ('Zscaler ThreatLabz',      'https://www.zscaler.com/blogs?type=security-research', 'research', 'https://www.zscaler.com/blogs/feeds/security-research'),
  ('Trend Micro Research',    'https://www.trendmicro.com/en_us/research.html',  'research',   'https://feeds.feedburner.com/TrendMicroSimplySecurity'),
  ('Elastic Security Labs',   'https://www.elastic.co/security-labs',            'research',   'https://www.elastic.co/security-labs/rss/feed.xml'),
  ('Qualys Security Blog',    'https://blog.qualys.com/',                        'research',   'https://blog.qualys.com/feed'),
  ('Rapid7 Blog',             'https://www.rapid7.com/blog/',                    'research',   'https://www.rapid7.com/blog/rss/'),
  ('Tenable Research',        'https://www.tenable.com/blog',                    'research',   'https://www.tenable.com/blog/feed'),
  ('Zero Day Initiative Advisories', 'https://www.zerodayinitiative.com/advisories/published/', 'research', 'https://www.zerodayinitiative.com/rss/published/')
on conflict (name) do nothing;

-- Sources with no usable feed, read from their listing page by a custom reader
-- (src/lib/ingest/readers). feed_url is the listing page, not a feed. Adding one
-- here without registering a reader for its URL makes the run report an error
-- rather than silently pulling nothing.
insert into sources (name, url, category, feed_url, feed_type) values
  ('CERT-EU Blog',            'https://cert.europa.eu/blog',                     'government', 'https://cert.europa.eu/blog', 'scraper')
on conflict (name) do nothing;

-- Sources without an RSS feed URL are manual (blog URL only).
update sources set feed_type = 'manual' where feed_url is null;
