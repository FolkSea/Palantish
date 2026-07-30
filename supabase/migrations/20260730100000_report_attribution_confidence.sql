-- ============================================================================
-- Report confidence -> attribution confidence (High / Medium / Low).
-- ----------------------------------------------------------------------------
-- For reports, confidence describes how confident the attribution is, which is
-- a different scale from the exploit/vuln status (confirmed / suspected / poc).
-- Convert intel_items.confidence to free High/Medium/Low text, defaulting to
-- Medium. Vulnerabilities keep the confidence_level enum for their status.
-- ============================================================================

alter table intel_items alter column confidence drop default;

alter table intel_items
  alter column confidence type text
  using (
    case
      when confidence is null then 'medium'
      when confidence::text = 'confirmed' then 'high'
      when confidence::text = 'suspected' then 'medium'
      when confidence::text = 'poc' then 'low'
      else 'medium'
    end
  );

alter table intel_items alter column confidence set default 'medium';

alter table intel_items drop constraint if exists intel_items_confidence_chk;
alter table intel_items
  add constraint intel_items_confidence_chk
  check (confidence is null or confidence in ('high', 'medium', 'low'));
