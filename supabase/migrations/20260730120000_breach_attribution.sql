-- ============================================================================
-- Attribution on breaches.
-- ----------------------------------------------------------------------------
-- Breaches feed the eCrime / hacktivism cards, where the crew is derived from
-- the text. These columns let an operator override that attribution from the
-- report modal; when set, the derived crew is ignored.
-- ============================================================================

alter table breaches add column if not exists adversary_label text;
alter table breaches add column if not exists crowdstrike_adversary text;
