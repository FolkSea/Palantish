-- Allowlist the Blogger image CDN, and apply the allowlist retroactively to
-- IOC rows that were stored before their domain was allowlisted.
--
-- blogger.googleusercontent.com is where Blogger-hosted sites (The Hacker News
-- among them) serve article images, so it turns up in scraped bodies as page
-- chrome and never as reported infrastructure. thehackernews.com itself was
-- already allowlisted by 20260731160000; it is repeated here only so this
-- migration reads as the complete statement of intent, and is a no-op there.
insert into ioc_allowlist (value, ioc_type, note) values
  ('blogger.googleusercontent.com', 'domain', 'blog image cdn'),
  ('thehackernews.com', 'domain', 'press')
on conflict (value, ioc_type) do nothing;

-- Retroactive cleanup. The extractor has always applied the allowlist to both
-- domain and uri indicators, but only at ingest time - rows written before an
-- entry existed survive, which is why allowlisted press domains are still in
-- the data as URLs. Delete them; the intel_item_iocs links cascade.
--
-- Matching mirrors isExcludedDomain() in src/lib/report-indicators.ts: an entry
-- covers itself and its subdomains, and nothing else. The '%.' || value form
-- matters - a bare '%' || value would also delete not-thehackernews.com.evil.ru,
-- which is exactly the kind of host that IS an IOC.
with matched as (
  select i.id
  from iocs i
  cross join lateral (
    select case
      when i.ioc_type = 'uri'
        then regexp_replace(
               lower(substring(i.value from '^[a-z]+://([^/:?#]+)')), '^www\.', '')
      else lower(i.value)
    end as host
  ) h
  where i.ioc_type in ('domain', 'uri')
    and h.host is not null
    and exists (
      select 1 from ioc_allowlist a
      where a.ioc_type <> 'ip'
        and (h.host = a.value or h.host like '%.' || a.value)
    )
)
delete from iocs where id in (select id from matched);
