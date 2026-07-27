import {
  CONFIDENCE_STYLE,
  VULN_STATUS_STYLE,
  csAdversaryClass,
  type Confidence,
} from "@/lib/badges";

const base =
  "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide leading-none";

export function ConfidenceBadge({ value }: { value: Confidence | null }) {
  if (!value) return null;
  const s = CONFIDENCE_STYLE[value];
  return <span className={`${base} ${s.className}`}>{s.label}</span>;
}

export function VulnStatusBadge({
  value,
}: {
  value: "confirmed" | "suspected" | "poc";
}) {
  const s = VULN_STATUS_STYLE[value];
  return <span className={`${base} ${s.className}`}>{s.label}</span>;
}

export function CrowdStrikeBadge({ name }: { name: string | null }) {
  if (!name) return null;
  return (
    <span className={`${base} ${csAdversaryClass(name)}`} title="CrowdStrike adversary">
      CS: {name}
    </span>
  );
}

export function SourceBadge({ name }: { name: string | null }) {
  if (!name) return null;
  return (
    <span
      className={`${base} border-slate-300 bg-slate-50 text-slate-600 normal-case tracking-normal`}
    >
      {name}
    </span>
  );
}

export function StatusPill({ status }: { status: "active" | "quiet" }) {
  const active = status === "active";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide leading-none ${
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-300 bg-slate-100 text-slate-500"
      }`}
    >
      {active ? "ACTIVE" : "NO NEW REPORTING"}
    </span>
  );
}
