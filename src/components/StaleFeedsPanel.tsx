import { formatDate } from "@/lib/format";
import type { StaleFeed } from "@/lib/data";

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/**
 * Warning panel listing active feeds whose newest item is over 30 days old (or
 * that have never produced content / are failing to fetch). Hidden when all
 * feeds are healthy.
 */
export function StaleFeedsPanel({ feeds }: { feeds: StaleFeed[] }) {
  if (!feeds.length) return null;
  return (
    <section className="rounded-[10px] border border-amber-300 bg-amber-50 p-4">
      <h2 className="text-[13px] font-semibold text-amber-800">
        Potentially stale feeds ({feeds.length})
      </h2>
      <p className="mt-0.5 text-[11px] text-amber-700">
        These active feeds have not posted in over 30 days (or are failing to
        fetch) and may need their feed URL checked or updated.
      </p>
      <ul className="mt-3 space-y-1.5">
        {feeds.map((f) => {
          const days = daysSince(f.lastItemAt);
          return (
            <li
              key={f.name}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px]"
            >
              <span className="font-medium text-slate-900">{f.name}</span>
              <span className="rounded border border-amber-300 bg-white px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-700">
                {f.category}
              </span>
              <span className="text-amber-800">
                {f.lastItemAt
                  ? `Last item ${formatDate(f.lastItemAt)} (${days} days ago)`
                  : "No items seen"}
              </span>
              {f.lastError ? (
                <span className="text-[11px] text-red-600">
                  Fetch error: {f.lastError.replace(/\s+/g, " ").slice(0, 120)}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
