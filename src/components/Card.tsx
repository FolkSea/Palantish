import type { ReactNode } from "react";

export function Card({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[10px] border border-[#e5e7eb] bg-white p-4 ${className}`}
    >
      <h2 className="text-[13px] font-semibold text-slate-900">{title}</h2>
      {subtitle ? (
        <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>
      ) : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-[12px] text-slate-400">
      {children}
    </p>
  );
}
