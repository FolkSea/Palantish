-- ============================================================================
-- Collapse the report network's shared indicators in the database.
-- ----------------------------------------------------------------------------
-- The network page read every intel_item_iocs row - thousands of them, a
-- thousand at a time - and expanded the pairs in JavaScript. The rows were only
-- ever the working material: what the page draws is a few hundred connections,
-- each two reports and a weight. Doing the collapse here sends that instead.
--
-- security invoker (the default), so the caller's row-level security applies:
-- this reads exactly what the reader could have read for themselves.
--
-- Hidden reports are removed before the fan-out is counted, not after. An
-- indicator is dropped for being too widely shared, and a report the reader
-- cannot see must not push it over that line.
--
-- The implementation this replaces had to de-duplicate its input, because it
-- took a list of links; here the pair is the primary key of intel_item_iocs,
-- so a repeated link cannot exist to inflate a weight.
--
-- Checked against that implementation over the real corpus before replacing it
-- - 7,951 links, 548 reports - producing identical pairs and identical weights
-- at fan-out limits of 2, 3, 5 and 25, and identical counts of the indicators
-- dropped for exceeding them. vitest cannot reach a database, so that
-- comparison is the coverage this function has.
-- ============================================================================

create or replace function public.report_network(max_fanout int default 25)
returns jsonb
language sql
stable
as $$
  with visible as (
    select l.intel_item_id, l.ioc_id
      from public.intel_item_iocs l
      join public.intel_items i on i.id = l.intel_item_id
     where not exists (
             select 1 from public.hidden_items h where h.raw_hash = i.raw_hash
           )
  ),
  fanout as (
    select ioc_id, count(*) as reports
      from visible
     group by ioc_id
    having count(*) >= 2
  ),
  -- An indicator in this many reports says "these are all advisories", not
  -- that they are related, and would cost a pair for every combination.
  usable as (
    select ioc_id from fanout where reports <= max_fanout
  ),
  pairs as (
    select l1.intel_item_id as a,
           l2.intel_item_id as b,
           count(*)::int as weight
      from visible l1
      join visible l2
        on l2.ioc_id = l1.ioc_id
       -- Each unordered pair once. uuid ordering is arbitrary but consistent,
       -- which is all the halving needs.
       and l2.intel_item_id > l1.intel_item_id
      join usable u on u.ioc_id = l1.ioc_id
     group by 1, 2
  )
  select jsonb_build_object(
    'pairs', coalesce(
      (select jsonb_agg(jsonb_build_array(a, b, weight)) from pairs), '[]'::jsonb
    ),
    'dropped', (select count(*) from fanout where reports > max_fanout)
  );
$$;

comment on function public.report_network(int) is
  'Report-to-report connections for the network view: each pair of reports that share an indicator, weighted by how many they share. Excludes indicators shared by more than max_fanout reports, and reports the caller has hidden.';

revoke all on function public.report_network(int) from public;
grant execute on function public.report_network(int) to authenticated, service_role;
