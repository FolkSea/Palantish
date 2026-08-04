-- ============================================================================
-- Point existing operational notifications at the panel they are about.
-- ----------------------------------------------------------------------------
-- These used to link to /settings, which opens on Account - leaving the reader
-- to go looking for the thing they were just told about. New ones carry the
-- panel; this brings the ones already sitting in someone's bell into line,
-- because those are the notifications they are about to click.
-- ============================================================================

update public.notifications
set href = case kind
  when 'stale_feeds'   then '/settings?tab=sources'
  when 'ingest_errors' then '/settings?tab=sources'
  when 'suspect_iocs'  then '/settings?tab=review'
  when 'new_user'      then '/settings?tab=users'
  else href
end
where href = '/settings'
  and kind in ('stale_feeds', 'ingest_errors', 'suspect_iocs', 'new_user');
