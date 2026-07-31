-- ============================================================================
-- Configurable IOC allowlist: values that must never be treated as indicators
-- of compromise when scraping report text. Two kinds:
--   * domain - a vendor / research / press / standards domain that is referenced
--     in reports but is not attacker infrastructure. Matches subdomains too
--     (adding crowdstrike.com also excludes blog.crowdstrike.com).
--   * ip     - a specific public IP that is noise rather than an IOC (public DNS
--     resolvers, sinkholes). Loopback / private / link-local ranges are dropped
--     programmatically in the extractor and need not be listed here.
-- Operators add rows here; the ingest pipeline loads them and drops any match.
-- ============================================================================

create table if not exists ioc_allowlist (
  id         uuid primary key default gen_random_uuid(),
  value      text not null,
  ioc_type   text not null default 'domain',
  note       text,
  created_at timestamptz not null default now(),
  constraint ioc_allowlist_type_check check (ioc_type in ('domain', 'ip')),
  unique (value, ioc_type)
);

alter table ioc_allowlist enable row level security;

-- Read-only for any authenticated user; writes go through the service role.
create policy "read ioc_allowlist" on ioc_allowlist
  for select to authenticated using (public.is_allowed_user());

grant select on ioc_allowlist to authenticated;
grant all on ioc_allowlist to service_role;

-- --------------------------------------------------------------------------
-- Seed with common vendor / research / press / standards domains that recur in
-- reports as references (not infrastructure), plus a few noise IPs. Deliberately
-- excludes generic hosting / CDN / paste / URL-shortener domains, which are
-- routinely abused as real C2 and must still surface as IOCs.
-- --------------------------------------------------------------------------
insert into ioc_allowlist (value, ioc_type, note) values
  -- security vendors & research blogs
  ('crowdstrike.com', 'domain', 'vendor'),
  ('microsoft.com', 'domain', 'vendor'),
  ('mandiant.com', 'domain', 'vendor'),
  ('fireeye.com', 'domain', 'vendor'),
  ('paloaltonetworks.com', 'domain', 'vendor'),
  ('unit42.com', 'domain', 'vendor'),
  ('symantec.com', 'domain', 'vendor'),
  ('broadcom.com', 'domain', 'vendor'),
  ('kaspersky.com', 'domain', 'vendor'),
  ('securelist.com', 'domain', 'vendor'),
  ('welivesecurity.com', 'domain', 'vendor'),
  ('eset.com', 'domain', 'vendor'),
  ('sentinelone.com', 'domain', 'vendor'),
  ('sophos.com', 'domain', 'vendor'),
  ('trendmicro.com', 'domain', 'vendor'),
  ('mcafee.com', 'domain', 'vendor'),
  ('trellix.com', 'domain', 'vendor'),
  ('cisco.com', 'domain', 'vendor'),
  ('talosintelligence.com', 'domain', 'vendor'),
  ('secureworks.com', 'domain', 'vendor'),
  ('recordedfuture.com', 'domain', 'vendor'),
  ('checkpoint.com', 'domain', 'vendor'),
  ('fortinet.com', 'domain', 'vendor'),
  ('fortiguard.com', 'domain', 'vendor'),
  ('bitdefender.com', 'domain', 'vendor'),
  ('malwarebytes.com', 'domain', 'vendor'),
  ('proofpoint.com', 'domain', 'vendor'),
  ('zscaler.com', 'domain', 'vendor'),
  ('cybereason.com', 'domain', 'vendor'),
  ('group-ib.com', 'domain', 'vendor'),
  ('intezer.com', 'domain', 'vendor'),
  ('dragos.com', 'domain', 'vendor'),
  ('volexity.com', 'domain', 'vendor'),
  ('huntress.com', 'domain', 'vendor'),
  ('redcanary.com', 'domain', 'vendor'),
  ('rapid7.com', 'domain', 'vendor'),
  ('tenable.com', 'domain', 'vendor'),
  ('qualys.com', 'domain', 'vendor'),
  ('darktrace.com', 'domain', 'vendor'),
  ('greynoise.io', 'domain', 'vendor'),
  ('domaintools.com', 'domain', 'vendor'),
  ('elastic.co', 'domain', 'vendor'),
  ('splunk.com', 'domain', 'vendor'),
  ('ibm.com', 'domain', 'vendor'),
  -- threat-intel & analysis platforms
  ('virustotal.com', 'domain', 'ti-platform'),
  ('abuse.ch', 'domain', 'ti-platform'),
  ('alienvault.com', 'domain', 'ti-platform'),
  ('urlscan.io', 'domain', 'ti-platform'),
  ('any.run', 'domain', 'ti-platform'),
  ('hybrid-analysis.com', 'domain', 'ti-platform'),
  ('joesandbox.com', 'domain', 'ti-platform'),
  ('tria.ge', 'domain', 'ti-platform'),
  ('threatconnect.com', 'domain', 'ti-platform'),
  ('misp-project.org', 'domain', 'ti-platform'),
  ('shodan.io', 'domain', 'ti-platform'),
  ('censys.io', 'domain', 'ti-platform'),
  -- standards / CVE / government
  ('mitre.org', 'domain', 'standards'),
  ('cve.org', 'domain', 'standards'),
  ('cvedetails.com', 'domain', 'standards'),
  ('nist.gov', 'domain', 'standards'),
  ('cisa.gov', 'domain', 'standards'),
  ('ncsc.gov.uk', 'domain', 'standards'),
  ('enisa.europa.eu', 'domain', 'standards'),
  ('first.org', 'domain', 'standards'),
  ('sans.org', 'domain', 'standards'),
  -- infosec press
  ('bleepingcomputer.com', 'domain', 'press'),
  ('thehackernews.com', 'domain', 'press'),
  ('therecord.media', 'domain', 'press'),
  ('securityweek.com', 'domain', 'press'),
  ('darkreading.com', 'domain', 'press'),
  ('krebsonsecurity.com', 'domain', 'press'),
  ('theregister.com', 'domain', 'press'),
  ('threatpost.com', 'domain', 'press'),
  ('infosecurity-magazine.com', 'domain', 'press'),
  ('cyberscoop.com', 'domain', 'press'),
  ('helpnetsecurity.com', 'domain', 'press'),
  -- noise IPs (loopback / private ranges are handled in-code)
  ('127.0.0.1', 'ip', 'loopback'),
  ('0.0.0.0', 'ip', 'unspecified'),
  ('255.255.255.255', 'ip', 'broadcast'),
  ('8.8.8.8', 'ip', 'public dns'),
  ('8.8.4.4', 'ip', 'public dns'),
  ('1.1.1.1', 'ip', 'public dns'),
  ('1.0.0.1', 'ip', 'public dns')
on conflict (value, ioc_type) do nothing;
