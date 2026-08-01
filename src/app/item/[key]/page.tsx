import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { loadItem } from "@/lib/browse";
import { ReportDetail } from "@/components/ReportDetail";

// Always render fresh intel; never cache the authenticated view.
export const dynamic = "force-dynamic";

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

  return (
    <div className="h-screen p-[5px]">
      <ReportDetail report={item} asPage />
    </div>
  );
}
