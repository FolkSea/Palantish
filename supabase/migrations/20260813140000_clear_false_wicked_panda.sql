-- ============================================================================
-- Undo the attributions that came from an ordinary word.
-- ----------------------------------------------------------------------------
-- WINNTI GROUP carried the alias LEAD, and the matcher took any four-character
-- alias, so reports containing "lead to" were attributed to it. The previous
-- migration then renamed all of those to WICKED PANDA - which moved the false
-- positives rather than removing them.
--
-- The corrected rule is applied here to what is already stored: a report keeps
-- its attribution only where its own title or summary names the actor. That is
-- the same test the ingest now applies, expressed against the catalogue rows
-- rather than in TypeScript, so the two cannot disagree about who WICKED PANDA
-- answers to.
--
-- Only the actor name is cleared. country and motivation are left as they are:
-- a report whose China nexus came from the bad match should lose it too, but
-- one whose nexus the model decided independently should not, and nothing
-- stored distinguishes them. A cleared report reads as UNID PANDA - still a
-- claim, but a visibly unattributed one that an analyst can correct.
--
-- The article body is deliberately not consulted. It is what let a mention in a
-- related-links block attribute a report in the first place.
--
-- Idempotent: re-running clears nothing further.
-- ============================================================================

do $$
declare
  v_before  bigint;
  v_kept    bigint;
  v_cleared bigint;
begin
  select count(*) into v_before
    from public.intel_items where adversary_label = 'WICKED PANDA';

  -- Every name the actor answers to, per the catalogue. Aliases are escaped
  -- before going into a regex: they are data, and a metacharacter in one would
  -- otherwise change what the pattern means.
  create temporary table wicked_alias on commit drop as
    select regexp_replace(alias, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') as pattern
      from public.adversaries a,
           lateral unnest(
             array[a.name]
             || coalesce(a.community_identifiers, '{}')
             || coalesce(a.internal_alternative_names, '{}')
           ) as alias
     where a.name = 'WICKED PANDA'
       and length(trim(alias)) >= 4;

  select count(*) into v_kept
    from public.intel_items i
   where i.adversary_label = 'WICKED PANDA'
     and exists (
       select 1 from wicked_alias w
        where (coalesce(i.title, '') || ' ' || coalesce(i.description, ''))
              ~* ('\m' || w.pattern || '\M')
     );

  update public.intel_items i
     set adversary_label = null,
         crowdstrike_adversary = null
   where i.adversary_label = 'WICKED PANDA'
     and not exists (
       select 1 from wicked_alias w
        where (coalesce(i.title, '') || ' ' || coalesce(i.description, ''))
              ~* ('\m' || w.pattern || '\M')
     );
  get diagnostics v_cleared = row_count;

  raise notice 'WICKED PANDA: % attributed, % name the actor and were kept, % cleared',
    v_before, v_kept, v_cleared;
end $$;
