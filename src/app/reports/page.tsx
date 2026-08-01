import Link from "next/link";
import { loadBrowse, BROWSE_LIMIT } from "@/lib/browse";
import {
  BROWSE_KIND_LABEL,
  parseBrowseParams,
  type BrowseKind,
} from "@/lib/browse-links";
import { BrowseList } from "@/components/BrowseList";

// Always render fresh intel; never cache the authenticated view.
export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Partial<Record<BrowseKind, string | string[]>>>;
}) {
  const filter = parseBrowseParams(await searchParams);
  const result = filter ? await loadBrowse(filter) : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-4 rounded-lg bg-[#2855D9] px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[15px] font-semibold text-white">
              {filter ? (
                <>
                  <span className="opacity-80">
                    {BROWSE_KIND_LABEL[filter.kind]}:
                  </span>{" "}
                  {filter.value}
                </>
              ) : (
                "Reports"
              )}
            </h1>
            <p className="text-[11px] text-white/70">
              {result
                ? `${result.items.length}${result.truncated ? "+" : ""} report${
                    result.items.length === 1 ? "" : "s"
                  }, most recent first`
                : "Choose a label, adversary or source to browse."}
            </p>
          </div>
          <Link
            href="/"
            className="rounded-md bg-white/15 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-white/25"
          >
            Back to dashboard
          </Link>
        </div>
      </header>

      {!filter ? (
        <p className="rounded-lg border border-[#e5e7eb] bg-white p-4 text-[13px] text-slate-500">
          Nothing selected. Click a label, adversary or source on the dashboard
          to see its reports here.
        </p>
      ) : (
        <>
          <BrowseList items={result?.items ?? []} />
          {result?.truncated ? (
            <p className="mt-2 text-[11px] text-slate-500">
              Showing the {BROWSE_LIMIT} most recent matches. Narrow the filter to
              see older reports.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
