import Link from "next/link";
import { seedGraphAction } from "./actions";
import GraphView from "@/components/graph/GraphView";

export const dynamic = "force-dynamic";

export default async function GraphPage({
  searchParams,
}: {
  searchParams: Promise<{ seed?: string }>;
}) {
  const { seed } = await searchParams;
  // Seed on the server (RLS-scoped) so the first paint has the depth-1 graph.
  const result = seed ? await seedGraphAction(seed) : null;
  const initial = result?.ok ? result.graph : null;
  const seedId = result?.ok ? result.seedId ?? null : null;
  const error = result && !result.ok ? result.error : undefined;

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e5e7eb] bg-white px-4 py-2.5">
        <div>
          <h1 className="text-[15px] font-semibold text-slate-900">
            Link analysis
          </h1>
          <p className="text-[11px] text-slate-500">
            Seeded two steps out. Tap a node to expand it further; choose which
            entity types to follow on the left.
          </p>
        </div>
        <Link
          href="/"
          className="rounded-md border border-[#e5e7eb] bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
        >
          Back to dashboard
        </Link>
      </header>
      <div className="flex min-h-0 flex-1">
        <GraphView initial={initial} seedId={seedId} error={error} />
      </div>
    </div>
  );
}
