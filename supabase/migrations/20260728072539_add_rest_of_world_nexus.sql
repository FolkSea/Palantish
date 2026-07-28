-- Add a fifth nation-state category for state-sponsored activity outside the
-- four tracked nations (kept distinct from the eCrime "other" nexus).
-- Must be committed before the value is used (see the next migration).
alter type actor_nexus add value if not exists 'rest_of_world';
