import { seedGraphAction } from "./actions";
import GraphView from "@/components/graph/GraphView";
import { SiteHeader } from "@/components/SiteHeader";

export const dynamic = "force-dynamic";

export default async function GraphPage({
  searchParams,
}: {
  searchParams: Promise<{ seed?: string }>;
}) {
  const { seed } = await searchParams;
  const result = seed ? await seedGraphAction(seed) : null;
  const initial = result?.ok ? result.graph : null;
  const error = result && !result.ok ? result.error : undefined;

  return (
    <div className="flex h-screen flex-col bg-slate-50 px-4 pt-4">
      {/* The header keeps its usual margin; the canvas takes what is left. */}
      <SiteHeader />
      <header className="flex shrink-0 items-center justify-between gap-3 rounded-t-lg border border-b-0 border-[#e5e7eb] bg-white px-4 py-2.5">
        <div>
          <h1 className="text-[15px] font-semibold text-slate-900">
            Link analysis
          </h1>
          <p className="text-[11px] text-slate-500">
            Seeded two steps out. Tap a node to expand it further; choose which
            entity types to follow on the left.
          </p>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 pb-4">
        <GraphView initial={initial} error={error} />
      </div>
    </div>
  );
}
