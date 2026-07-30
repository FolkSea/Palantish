-- ============================================================================
-- Drop the adversary animal_classifier ("Family").
-- ----------------------------------------------------------------------------
-- The family concept is retired: an actor's classification is now motivation +
-- country, and the ingest attributes intel by the stored nexus (which was
-- derived from the animal at load time), so the animal is no longer needed on
-- the actor. The loader still derives nexus/motivation/country from the source
-- JSON's animal cryptonym; it just no longer stores the animal itself.
-- ============================================================================

drop index if exists adversaries_animal_idx;
alter table adversaries drop column if exists animal_classifier;
