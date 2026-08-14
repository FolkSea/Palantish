import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { loadItem } from "@/lib/browse";
import { ReportDetail } from "@/components/ReportDetail";
import { SiteHeader } from "@/components/SiteHeader";
import { getAuthenticatedClient } from "@/lib/auth";
import { readingPrefsFrom } from "@/lib/reading-prefs";
import { isBookmarked } from "@/app/bookmark-actions";

// Always render fresh intel; never cache the authenticated view.
export const dynamic = "force-dynamic";

// The panel's re-analysis runs as a server action on this route, and re-reading
// a long article takes minutes. The platform ceiling, so the model's own timeout
// is what ends the call.
export const maxDuration = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<Metadata> {
  const { key } = await params;
  const item = await loadItem(decodeURIComponent(key));
  if (!item) return { title: "Report not found" };
  return {
    title: item.title,
    description: item.description ?? undefined,
  };
}

export default async function ItemPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const item = await loadItem(decodeURIComponent(key));
  if (!item) notFound();

  const auth = await getAuthenticatedClient();
  const reading = readingPrefsFrom(auth?.user?.user_metadata);
  const bookmarked = await isBookmarked(item.id ?? "");

  return (
    // A column so the report fills whatever the header leaves.
    <div className="flex h-screen flex-col px-4 pt-4">
      <SiteHeader />
      <div className="min-h-0 flex-1 pb-4">
        <ReportDetail
          report={item}
          asPage
          reading={reading}
          bookmarked={bookmarked}
        />
      </div>
    </div>
  );
}
