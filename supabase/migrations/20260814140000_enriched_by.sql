-- ============================================================================
-- Record which classifier a report came in on.
-- ----------------------------------------------------------------------------
-- Under llm-first the deterministic rules only run when the model could not be
-- reached, so a rules-classified report is a report nobody read: no labels, no
-- adversary, no nexus. That is not visibly different from a report about
-- nothing in particular, it matches no subscription, and until now the only
-- trace of it was a count in a notification - the reports themselves could not
-- be found again.
--
-- 'rules'    - stored unclassified, waiting for somebody to look at it.
-- 'llm'      - the model classified it, at ingest or on a later re-analysis.
-- 'reviewed' - an analyst has been through it and it needs no more attention.
--
-- Null for everything that predates this, which is not the same as 'llm': the
-- honest answer for those rows is that nobody recorded it, and a review queue
-- that suddenly claimed six months of history would not be reviewed at all.
--
-- The index is partial because the queue is the only thing ever queried: a few
-- rows out of thousands, and it stays that size as they are worked through.
-- ============================================================================

alter table public.intel_items
  add column if not exists enriched_by text;

comment on column public.intel_items.enriched_by is
  'Which classifier produced this report: rules (unclassified, needs review), llm, or reviewed (an analyst has seen it). Null for rows stored before this was recorded.';

create index if not exists intel_items_unclassified_idx
  on public.intel_items (created_at desc)
  where enriched_by = 'rules';
