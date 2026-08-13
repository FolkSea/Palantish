import Link from "next/link";
import {
  ADVERSARY_BADGE_CLASS,
  PRIORITY_STYLE,
  REPORT_CONFIDENCE_STYLE,
  VULN_STATUS_STYLE,
  type ReportConfidence,
  type VulnPriority,
} from "@/lib/badges";

const base =
  "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide leading-none";

export function ConfidenceBadge({ value }: { value: string | null }) {
  if (!value) return null;
  const s = REPORT_CONFIDENCE_STYLE[value as ReportConfidence];
  if (!s) return null;
  return (
    <span className={`${base} ${s.className}`} title="Attribution confidence">
      {s.label}
    </span>
  );
}

export function VulnStatusBadge({
  value,
}: {
  value: "confirmed" | "suspected" | "poc";
}) {
  const s = VULN_STATUS_STYLE[value];
  return <span className={`${base} ${s.className}`}>{s.label}</span>;
}

export function PriorityBadge({ value }: { value: VulnPriority }) {
  const s = PRIORITY_STYLE[value];
  return <span className={`${base} ${s.className}`}>{s.label}</span>;
}

export function AdversaryBadge({
  name,
  href,
}: {
  name: string | null;
  /** When given, the badge links to this adversary's reports. */
  href?: string;
}) {
  if (!name) return null;
  const cls = `${base} ${ADVERSARY_BADGE_CLASS}`;
  if (href)
    return (
      <Link href={href} className={`${cls} hover:brightness-95`} title={`All reports for ${name}`}>
        {name}
      </Link>
    );
  return (
    <span className={cls} title="Adversary">
      {name}
    </span>
  );
}

export function SourceBadge({
  name,
  href,
}: {
  name: string | null;
  /** When given, the badge links to this source's reports. */
  href?: string;
}) {
  if (!name) return null;
  const cls = `${base} border-slate-300 bg-slate-50 text-slate-600 normal-case tracking-normal`;
  if (href)
    return (
      <Link href={href} className={`${cls} hover:bg-slate-100`} title={`All reports from ${name}`}>
        {name}
      </Link>
    );
  return <span className={cls}>{name}</span>;
}
