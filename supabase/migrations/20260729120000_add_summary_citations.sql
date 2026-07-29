-- ============================================================================
-- Executive summary citations: the reports/vulns/breaches the AI summary refers
-- to, stored so the "[n]" markers in the prose can link to the underlying item.
-- Each entry carries the fields the report modal needs (title, url, etc.).
-- ============================================================================
alter table executive_summaries add column citations jsonb;
