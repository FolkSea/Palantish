"use client";

import { useMemo } from "react";
import CategoryScatter, { type ScatterPoint } from "./CategoryScatter";
import type { EcrimeTimelinePoint } from "@/lib/data";

const PALETTE = [
  "#e11d48",
  "#0d9488",
  "#7c3aed",
  "#ea580c",
  "#2563eb",
  "#059669",
  "#d97706",
  "#9333ea",
  "#0891b2",
  "#dc2626",
];

export default function EcrimeTimeline({
  rows,
}: {
  rows: EcrimeTimelinePoint[];
}) {
  const { points, categories, colors } = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.actor] = (counts[r.actor] ?? 0) + 1;

    const named = Object.keys(counts)
      .filter((c) => c !== "Unattributed")
      .sort((a, b) => counts[b] - counts[a]);
    const categories = [
      ...named,
      ...(counts["Unattributed"] ? ["Unattributed"] : []),
    ];

    const colors: Record<string, string> = {};
    categories.forEach((c, i) => {
      colors[c] = c === "Unattributed" ? "#94a3b8" : PALETTE[i % PALETTE.length];
    });

    const points: ScatterPoint[] = rows.map((r) => ({
      x: new Date(`${r.date}T12:00:00Z`).getTime(),
      category: r.actor,
      title: r.title,
      lines: [r.summary ?? "", r.source ? `Source: ${r.source}` : ""].filter(
        Boolean,
      ),
      url: r.url,
    }));

    return { points, categories, colors };
  }, [rows]);

  if (!rows.length) {
    return (
      <p className="py-10 text-center text-[12px] text-slate-400">
        No eCrime incidents in the last 30 days.
      </p>
    );
  }

  return (
    <CategoryScatter
      points={points}
      categories={categories}
      colors={colors}
      days={30}
    />
  );
}
