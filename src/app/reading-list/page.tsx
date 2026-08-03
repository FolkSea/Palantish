import type { Metadata } from "next";
import { loadReadingList } from "@/lib/reading-list";
import { ReportTable } from "@/components/ReportTable";
import { SiteHeader } from "@/components/SiteHeader";

// The list changes as the reader saves and clears things; never cache it.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reading list",
  description: "Reports you have saved to work on.",
};

export default async function ReadingListPage() {
  const { items } = await loadReadingList();

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <SiteHeader />

      <div className="mb-4">
        <h1 className="text-[20px] font-semibold text-slate-900">Reading list</h1>
        <p className="mt-0.5 text-[13px] text-slate-500">
          Reports you have saved, most recently added first.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-[10px] border border-[#e5e7eb] bg-white p-4 text-[13px] text-slate-500">
          <p>Nothing saved yet.</p>
          <p className="mt-1">
            Open a report and use <span className="font-medium">Save</span> in
            its header to keep it here while you work on it.
          </p>
        </div>
      ) : (
        <ReportTable
          title="Saved reports"
          items={items}
          subtitle={`${items.length} saved`}
        />
      )}
    </div>
  );
}
