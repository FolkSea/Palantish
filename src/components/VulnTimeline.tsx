"use client";

import { useMemo } from "react";
import CategoryScatter, { type ScatterPoint } from "./CategoryScatter";
import type { VulnTimelinePoint } from "@/lib/data";

const STATUS_LABEL: Record<VulnTimelinePoint["status"], string> = {
  confirmed: "Confirmed",
  poc: "PoC",
  suspected: "Suspected",
};

// PoC first so it sits at the top of the chart (most critical), in red.
const CATEGORIES = ["PoC", "Confirmed", "Suspected"];
const COLORS: Record<string, string> = {
  PoC: "#dc2626",
  Confirmed: "#059669",
  Suspected: "#d97706",
};

export default function VulnTimeline({ rows }: { rows: VulnTimelinePoint[] }) {
  const points = useMemo<ScatterPoint[]>(
    () =>
      rows.map((v) => ({
        x: new Date(`${v.date}T12:00:00Z`).getTime(),
        category: STATUS_LABEL[v.status],
        title: v.cveId,
        lines: [
          v.target ? `Target: ${v.target}` : "",
          v.detail ?? "",
        ].filter(Boolean),
        url: v.url,
      })),
    [rows],
  );

  if (!rows.length) {
    return (
      <p className="py-10 text-center text-[12px] text-slate-400">
        No vulnerability reporting in the last 30 days.
      </p>
    );
  }

  return (
    <CategoryScatter
      points={points}
      categories={CATEGORIES}
      colors={COLORS}
      days={30}
    />
  );
}
