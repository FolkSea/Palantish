import dynamicImport from "next/dynamic";
import { reportNetworkAction } from "./actions";
import { SiteHeader } from "@/components/SiteHeader";

export const dynamic = "force-dynamic";

const NetworkView = dynamicImport(
  () => import("@/components/graph/NetworkView"),
);

export default async function NetworkPage() {
  const result = await reportNetworkAction();
  const graph = result.ok ? result.graph : null;
  const error = result.ok ? undefined : result.error;
  const dropped = result.ok ? (result.droppedEntities ?? 0) : 0;

  return (
    <div className="flex h-screen flex-col bg-slate-50 px-4 pt-4">
      <SiteHeader />
      <header className="flex shrink-0 items-center justify-between gap-3 rounded-t-lg border border-b-0 border-[#e5e7eb] bg-white px-4 py-2.5">
        <div>
          <h1 className="text-[15px] font-semibold text-slate-900">
            Report network
          </h1>
          <p className="text-[11px] text-slate-500">
            Reports and actors only. Every indicator two reports share is
            collapsed into one connection, thicker the more they share; reports
            connected to nothing are left out.
            {dropped > 0
              ? ` ${dropped} very common indicator${dropped === 1 ? "" : "s"} ` +
                `ignored, being too widely shared to mean a relationship.`
              : ""}
          </p>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 pb-4">
        <NetworkView graph={graph} error={error} />
      </div>
    </div>
  );
}
