-- How each source is ingested: an RSS/Atom feed, a manual (blog URL only)
-- source, or a future custom scraper.
alter table sources
  add column feed_type text not null default 'rss'
  check (feed_type in ('rss', 'manual', 'scraper'));

-- Backfill: sources without a feed URL are manual.
update sources set feed_type = 'manual' where feed_url is null;
