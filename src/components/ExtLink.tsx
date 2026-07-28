import type { ReactNode } from "react";

/** External link that opens in a new tab, or plain text when no href. */
export function ExtLink({
  href,
  children,
}: {
  href: string | null;
  children: ReactNode;
}) {
  if (!href)
    return <span className="font-medium text-slate-900">{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-[#1d4ed8] hover:underline"
    >
      {children}
    </a>
  );
}
