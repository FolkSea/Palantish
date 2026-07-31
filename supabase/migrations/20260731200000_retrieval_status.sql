-- ============================================================================
-- Web-fetch triage: record how a report's body was retrieved for analysis, and
-- the concise summary the triage agent produced from the fetched article.
--   retrieval_status = 'full'      - Claude's web_fetch confirmed retrieval;
--                      'feed_only' - fell back to the RSS title/description or
--                                    the app-side scraper (needs retrieval retry
--                                    / analyst review);
--                      'failed'    - could not retrieve or classify the body.
-- A report may be marked 'full' only when a web-fetch result confirms retrieval.
-- ============================================================================

alter table intel_items
  add column if not exists retrieval_status text
    check (retrieval_status in ('full', 'feed_only', 'failed')),
  add column if not exists report_summary text;

-- Operators review anything that did not fetch cleanly.
create index if not exists intel_items_retrieval_status_idx
  on intel_items (retrieval_status)
  where retrieval_status is not null and retrieval_status <> 'full';
