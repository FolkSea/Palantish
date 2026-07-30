-- ============================================================================
-- Analyst notes on a report: free-form markdown for analyst commentary and the
-- visibility gaps, edited from the report modal.
-- ============================================================================

alter table intel_items
  add column if not exists analyst_comments text,
  add column if not exists visibility_gaps text;
