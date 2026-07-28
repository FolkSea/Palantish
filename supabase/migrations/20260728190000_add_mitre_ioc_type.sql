-- ============================================================================
-- Allow MITRE ATT&CK technique codes to be stored in the iocs table (value =
-- the technique code, e.g. T1059.003), so they are deduped, linked to reports
-- and searchable in exactly the same way as other indicators.
-- ============================================================================
alter table iocs drop constraint iocs_type_check;
alter table iocs add constraint iocs_type_check
  check (ioc_type in ('ip', 'domain', 'uri', 'file_hash', 'mitre'));
