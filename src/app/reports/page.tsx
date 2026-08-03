import { loadBrowse, BROWSE_LIMIT } from "@/lib/browse";
import {
  BROWSE_KIND_LABEL,
  parseBrowseParams,
  type BrowseKind,
} from "@/lib/browse-links";
import { BrowseList } from "@/components/BrowseList";
import { SiteHeader } from "@/components/SiteHeader";

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
      <SiteHeader />

      <div className="mb-4">
        <h1 className="text-[18px] font-semibold text-slate-900">
          {filter ? (
            <>
              <span className="text-slate-500">
                {BROWSE_KIND_LABEL[filter.kind]}:
              </span>{" "}
              {filter.value}
            </>
          ) : (
            "Reports"
          )}
        </h1>
        <p className="mt-0.5 text-[12px] text-slate-500">
          {result
            ? `${result.items.length}${result.truncated ? "+" : ""} report${
                result.items.length === 1 ? "" : "s"
              }, most recent first`
            : "Choose a label, adversary or source to browse."}
        </p>
      </div>

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
