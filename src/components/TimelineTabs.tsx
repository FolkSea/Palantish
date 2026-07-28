"use client";

import { useState } from "react";
import TimelineChart from "./TimelineChart";
import EcrimeTimeline from "./EcrimeTimeline";
import VulnTimeline from "./VulnTimeline";
import type {
  TimelineRow,
  EcrimeTimelinePoint,
  VulnTimelinePoint,
} from "@/lib/data";

type TabId = "nation" | "ecrime" | "vuln";

const TABS: { id: TabId; label: string; caption: string }[] = [
  {
    id: "nation",
    label: "Nation State",
    caption:
      "Dates reflect report/advisory publication, not campaign start. Click a point to open the source.",
  },
  {
    id: "ecrime",
    label: "eCrime",
    caption:
      "eCrime incidents by actor, using the CrowdStrike cryptonym where known. Click a point to open the source.",
  },
  {
    id: "vuln",
    label: "Exploits & Vulnerabilities",
    caption:
      "Exploited and disclosed vulnerabilities by status. Click a point to open the source.",
  },
];

export default function TimelineTabs({
  timeline,
  ecrimeTimeline,
  vulnTimeline,
}: {
  timeline: TimelineRow[];
  ecrimeTimeline: EcrimeTimelinePoint[];
  vulnTimeline: VulnTimelinePoint[];
}) {
  const [tab, setTab] = useState<TabId>("nation");
  const active = TABS.find((t) => t.id === tab)!;

  return (
    <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-slate-900">
          Activity timeline (last 30 days)
        </h2>
        <div className="flex gap-1 rounded-md bg-slate-100 p-1 text-[12px]">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded px-2.5 py-1 font-medium transition ${
                tab === t.id
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-0.5 text-[11px] text-slate-500">{active.caption}</p>

      <div className="mt-3">
        {tab === "nation" &&
          (timeline.length ? (
            <TimelineChart rows={timeline} />
          ) : (
            <p className="py-10 text-center text-[12px] text-slate-400">
              No nation-state events in the last 30 days.
            </p>
          ))}
        {tab === "ecrime" && <EcrimeTimeline rows={ecrimeTimeline} />}
        {tab === "vuln" && <VulnTimeline rows={vulnTimeline} />}
      </div>
    </section>
  );
}
