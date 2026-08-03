-- ============================================================================
-- Register the CERT-EU blog as a scraped source.
-- ----------------------------------------------------------------------------
-- seed.sql only runs on a local `db reset`, so a new source has to reach the
-- deployed database as a migration. The blog publishes no working feed
-- (/blog/rss, /blog/feed and /rss all 404), so feed_url is its listing page and
-- feed_type is 'scraper' - read by the reader registered for that URL in
-- src/lib/ingest/readers. Idempotent, and it does not touch an existing row.
-- ============================================================================

insert into public.sources (name, url, category, feed_url, feed_type, active)
values (
  'CERT-EU Blog',
  'https://cert.europa.eu/blog',
  'government',
  'https://cert.europa.eu/blog',
  'scraper',
  true
)
on conflict (name) do nothing;
