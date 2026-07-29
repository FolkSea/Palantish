-- ============================================================================
-- Allow CVE identifiers (e.g. CVE-2026-12345) to be stored in the iocs table,
-- so referenced vulnerabilities are deduped, linked to reports and searchable
-- like any other indicator.
-- ============================================================================
alter table iocs drop constraint iocs_type_check;
alter table iocs add constraint iocs_type_check
  check (ioc_type in ('ip', 'domain', 'uri', 'file_hash', 'mitre', 'cve'));
