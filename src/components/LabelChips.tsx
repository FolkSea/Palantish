/**
 * Render a report's user-defined labels as small chips. Nothing renders when the
 * report has no labels, so callers can drop it in unconditionally.
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
        <span
          key={l}
          className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
        >
          {l}
        </span>
      ))}
    </span>
  );
}
