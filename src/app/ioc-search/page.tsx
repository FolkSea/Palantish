import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { IocSearchView } from "@/components/IocSearchView";

// The corpus changes with every ingest; never cache the authenticated view.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "IOC search",
  description: "Find the reports that carry a set of indicators.",
};

export default function IocSearchPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <SiteHeader />

      <div className="mb-4">
        <h1 className="text-[20px] font-semibold text-slate-900">IOC search</h1>
        <p className="mt-0.5 text-[13px] text-slate-500">
          Paste text containing indicators and see which reports carry them,
          grouped by indicator.
        </p>
      </div>

      <IocSearchView />
    </div>
  );
}
