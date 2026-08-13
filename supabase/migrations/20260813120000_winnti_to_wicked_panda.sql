-- ============================================================================
-- Re-attribute WINNTI GROUP to WICKED PANDA.
-- ----------------------------------------------------------------------------
-- WINNTI GROUP was removed from the catalogue, but the reports attributed to it
-- kept the name: attribution is stored on the row, and nothing re-enriches a
-- report after ingest. WICKED PANDA (APT41) already claims "Winnti" among its
-- community identifiers, so that is where this reporting belongs.
--
-- Both columns are set, not just one. adversary_label is what the dashboard
-- displays almost everywhere - the timeline, the actor cards and the report
-- lists all prefer it over crowdstrike_adversary - so changing only the latter
-- looks like it has done nothing.
--
-- country and motivation are left alone: both actors are China / nation_state,
-- and an analyst may have corrected a row by hand.
--
-- Idempotent: re-running matches nothing, because nothing is called WINNTI any
-- more.
-- ============================================================================

do $$
declare
  v_items   bigint;
  v_links   bigint;
  v_memory  bigint;
  v_winnti  uuid;
  v_wicked  uuid;
begin
  -- Matched on the whole value rather than a substring: this is an actor name
  -- in an attribution column, not prose, and "Winnti" appears inside plenty of
  -- titles that must not be rewritten.
  select count(*) into v_items
    from public.intel_items
   where upper(trim(adversary_label))       in ('WINNTI GROUP', 'WINNTI')
      or upper(trim(crowdstrike_adversary)) in ('WINNTI GROUP', 'WINNTI');

  update public.intel_items
     set adversary_label       = 'WICKED PANDA',
         crowdstrike_adversary = 'WICKED PANDA'
   where upper(trim(adversary_label))       in ('WINNTI GROUP', 'WINNTI')
      or upper(trim(crowdstrike_adversary)) in ('WINNTI GROUP', 'WINNTI');

  -- The Adversary/... chips are separate rows from the attribution columns, so
  -- they have to be moved as well or the report shows both names.
  select id into v_winnti from public.labels
   where lower(name) = lower('Adversary/WINNTI GROUP');

  if v_winnti is not null then
    select count(*) into v_links
      from public.intel_item_labels where label_id = v_winnti;

    insert into public.labels (name) values ('Adversary/WICKED PANDA')
      on conflict do nothing;
    select id into v_wicked from public.labels
     where lower(name) = lower('Adversary/WICKED PANDA');

    -- do nothing on conflict: a report may carry both chips already, and the
    -- pair is the primary key.
    insert into public.intel_item_labels (intel_item_id, label_id)
    select il.intel_item_id, v_wicked
      from public.intel_item_labels il
     where il.label_id = v_winnti
        on conflict do nothing;

    delete from public.intel_item_labels where label_id = v_winnti;
    delete from public.labels where id = v_winnti;
  else
    v_links := 0;
  end if;

  -- The analyst agent's note on the actor is injected into future triage
  -- prompts, so leaving it would re-attribute new reports to a name that no
  -- longer exists. Deleted rather than renamed: merging it into an existing
  -- WICKED PANDA note is not something a migration should try to write, and
  -- the agent rebuilds its memory on the next run.
  select count(*) into v_memory from public.analyst_memory
   where kind = 'adversary'
     and upper(trim(subject)) in ('WINNTI GROUP', 'WINNTI');

  delete from public.analyst_memory
   where kind = 'adversary'
     and upper(trim(subject)) in ('WINNTI GROUP', 'WINNTI');

  raise notice 'WINNTI -> WICKED PANDA: % reports re-attributed, % label links moved, % memory notes removed',
    v_items, v_links, v_memory;
  raise notice 'still named WINNTI: % reports, % labels',
    (select count(*) from public.intel_items
      where upper(trim(adversary_label)) like 'WINNTI%'
         or upper(trim(crowdstrike_adversary)) like 'WINNTI%'),
    (select count(*) from public.labels where upper(name) like '%WINNTI%');
end $$;
