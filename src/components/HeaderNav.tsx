"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The header's primary destinations.
 *
 * These three were in the hamburger, which made the views a reader uses
 * constantly cost a click to find. The menu keeps the things done rarely or
 * once - settings, imports, feed refreshes, logout.
 */
const LINKS = [
  {
    href: "/feed",
    label: "Personal Feed",
    // Broadcast waves.
    d: "M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16M6 19a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  },
  {
    href: "/reading-list",
    label: "Reading List",
    // Bookmark.
    d: "M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z",
  },
  {
    href: "/network",
    label: "Graph All",
    // Connected nodes.
    d: "M5 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM7 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6.5 5.5 17.5 7M6 8v9M8.5 18.5 16.5 17M17.5 9 8.5 17",
  },
];

export function HeaderNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1" aria-label="Main">
      {LINKS.map((l) => {
        const active = pathname === l.href;
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={
              "flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/60 " +
              (active
                ? "bg-white/20 text-white"
                : "text-[#C7D4FF] hover:bg-white/10 hover:text-white")
            }
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={l.d} />
            </svg>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
