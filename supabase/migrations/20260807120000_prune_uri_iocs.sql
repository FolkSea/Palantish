-- ============================================================================
-- Remove the URL indicators.
-- ----------------------------------------------------------------------------
-- URLs stopped being an indicator type: a report is full of them - the vendor's
-- own links, the references, the share buttons, the advisory it cites - and no
-- regex tells those from a payload URL. Nothing extracts, stores or displays
-- one any more.
--
-- The rows already written are still linked to their reports, though, and the
-- report network draws an edge for every indicator two reports share. Left in
-- place they would go on tying reports together by the vendor's own footer,
-- which is the false positive this change exists to remove - so they go.
--
-- Their hosts are not lost: the domain was already being extracted alongside
-- the URL, or is picked up on the next ingest of anything that names it.
--
-- Two foreign keys do the work, and neither needs a delete of its own:
--   intel_item_iocs.ioc_id  on delete cascade   -> the report links go with it
--   ioc_review_flags.ioc_id on delete set null  -> the audit trail is kept,
--                                                  which is why it was made
--                                                  set-null rather than cascade
--
-- Idempotent: running it again removes nothing, because nothing writes a uri
-- row any more.
-- ============================================================================

do $$
declare
  v_iocs  bigint;
  v_links bigint;
  v_flags bigint;
begin
  select count(*) into v_iocs
    from public.iocs where ioc_type = 'uri';

  select count(*) into v_links
    from public.intel_item_iocs l
    join public.iocs i on i.id = l.ioc_id
   where i.ioc_type = 'uri';

  select count(*) into v_flags
    from public.ioc_review_flags f
    join public.iocs i on i.id = f.ioc_id
   where i.ioc_type = 'uri';

  raise notice 'uri indicators: % rows, % report links, % review flags (flags kept, ioc_id set null)',
    v_iocs, v_links, v_flags;

  delete from public.iocs where ioc_type = 'uri';

  raise notice 'uri indicators remaining: %',
    (select count(*) from public.iocs where ioc_type = 'uri');
end $$;
