import Link from "next/link";
import { labelHref } from "@/lib/browse-links";

/**
 * Render a report's user-defined labels as small chips, each linking to every
 * report carrying that label. Nothing renders when the report has no labels, so
 * callers can drop it in unconditionally.
 */
export function LabelChips({
  labels,
  className = "",
}: {
  labels: string[] | null | undefined;
  className?: string;
}) {
  if (!labels || labels.length === 0) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {labels.map((l) => (
        <Link
          key={l}
          href={labelHref(l)}
          title={`All reports labelled ${l}`}
          className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-200 hover:text-slate-800"
        >
          {l}
        </Link>
      ))}
    </span>
  );
}
