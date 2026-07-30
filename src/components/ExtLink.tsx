import type { ReactNode } from "react";

/** External link that opens in a new tab, or plain text when no href. An
 *  optional className is appended (use Tailwind's `!` to override the colour). */
export function ExtLink({
  href,
  children,
  className,
}: {
  href: string | null;
  children: ReactNode;
  className?: string;
}) {
  if (!href)
    return (
      <span className={`font-medium text-slate-900 ${className ?? ""}`}>
        {children}
      </span>
    );
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`font-medium text-[#1d4ed8] hover:underline ${className ?? ""}`}
    >
      {children}
    </a>
  );
}
