-- ============================================================================
-- Extend the analyst agent's memory with a third note kind, 'label': the taxonomy
-- labels the triage agent coins for reports (AI/Malware/Adversary/Target). Storing
-- them in memory lets the agent reuse an existing label instead of coining a
-- near-duplicate, so labelling stays consistent across runs. Subject is the full
-- label (e.g. "Malware/FlyingEagle"); mentions/last_seen give it salience.
-- ============================================================================

alter table analyst_memory drop constraint analyst_memory_kind_check;
alter table analyst_memory
  add constraint analyst_memory_kind_check
  check (kind in ('adversary', 'trend', 'label'));
