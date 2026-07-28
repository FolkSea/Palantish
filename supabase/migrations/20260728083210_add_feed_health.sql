-- Per-feed freshness tracking for the "potentially stale feeds" warning.
-- last_item_at   = publication date of the newest item ever seen in the feed
-- last_fetched_at= last time the feed was successfully parsed
-- last_error     = last fetch/parse error (null when the last fetch succeeded)
alter table sources add column last_item_at    timestamptz;
alter table sources add column last_fetched_at timestamptz;
alter table sources add column last_error      text;
