-- ============================================================================
-- Persist the display adversary label on each intel item, so a derived label
-- (e.g. "UNID TIGER" for a Rest-of-the-World India post) is stored alongside
-- the post and can be edited by an operator later. Nullable: unattributed
-- reports carry no label.
-- ============================================================================
alter table intel_items add column adversary_label text;
