"use client";

import { useMemo } from "react";
import { Scatter } from "react-chartjs-2";
import {
  Chart as ChartJS,
  LinearScale,
  TimeScale,
  PointElement,
  Tooltip,
  Legend,
  type ChartOptions,
  type TooltipItem,
} from "chart.js";
import "chartjs-adapter-date-fns";
import {
  COUNTRY_COLOR,
  COUNTRY_POINT_STYLE,
  TIMELINE_COUNTRIES,
} from "@/lib/badges";
import type { TimelineRow } from "@/lib/data";

ChartJS.register(LinearScale, TimeScale, PointElement, Tooltip, Legend);

type Point = {
  x: number;
  y: number;
  title: string;
  description: string | null;
  source: string | null;
  url: string | null;
};

const DAY = 24 * 60 * 60 * 1000;

export default function TimelineChart({ rows }: { rows: TimelineRow[] }) {
  const { datasets, xMin, xMax } = useMemo(() => {
    const now = Date.now();
    const xMax = now + DAY / 2;
    const xMin = now - 30 * DAY;

    const datasets = TIMELINE_COUNTRIES.map((country, idx) => {
      const yBase = TIMELINE_COUNTRIES.length - 1 - idx; // top row = index high
      const points: Point[] = rows
        .filter((r) => r.country === country && r.published_at)
        .map((r) => ({
          x: new Date(r.published_at as string).getTime(),
          // slight vertical jitter so same-day events do not fully overlap
          y: yBase + (Math.random() - 0.5) * 0.24,
          title: r.title ?? "",
          description: r.description,
          source: r.source_name,
          url: r.url,
        }));
      return {
        label: country,
        data: points,
        backgroundColor: COUNTRY_COLOR[country],
        // White halo so overlapping same-colour dots stay individually legible.
        borderColor: "#ffffff",
        borderWidth: 1,
        pointStyle: COUNTRY_POINT_STYLE[country],
        pointRadius: 6,
        pointHoverRadius: 8,
      };
    });

    return { datasets, xMin, xMax };
  }, [rows]);

  const rowLabels = useMemo(
    () => [...TIMELINE_COUNTRIES].reverse(), // y index 0..3 bottom-to-top
    [],
  );

  const options: ChartOptions<"scatter"> = {
    responsive: true,
    maintainAspectRatio: false,
    onClick: (_evt, elements) => {
      if (!elements.length) return;
      const el = elements[0];
      const p = datasets[el.datasetIndex].data[el.index] as Point;
      if (p.url) window.open(p.url, "_blank", "noopener,noreferrer");
    },
    onHover: (evt, elements) => {
      const target = evt.native?.target as HTMLElement | undefined;
      if (target) target.style.cursor = elements.length ? "pointer" : "default";
    },
    scales: {
      x: {
        type: "time",
        min: xMin,
        max: xMax,
        time: { unit: "day", tooltipFormat: "MMM d, yyyy" },
        grid: { color: "#f1f5f9" },
        ticks: { color: "#6b7280", font: { size: 10 }, maxRotation: 0 },
      },
      y: {
        min: -0.5,
        max: TIMELINE_COUNTRIES.length - 0.5,
        grid: { color: "#f1f5f9" },
        ticks: {
          color: "#374151",
          font: { size: 11 },
          stepSize: 1,
          callback: (value) => rowLabels[value as number] ?? "",
        },
      },
    },
    plugins: {
      legend: {
        position: "bottom",
        labels: {
          usePointStyle: true,
          pointStyleWidth: 12,
          font: { size: 11 },
          color: "#374151",
        },
      },
      tooltip: {
        callbacks: {
          title: (items: TooltipItem<"scatter">[]) =>
            (items[0].raw as Point).title,
          label: (item: TooltipItem<"scatter">) => {
            const p = item.raw as Point;
            const lines: string[] = [];
            if (p.description) lines.push(p.description);
            if (p.source) lines.push(`Source: ${p.source}`);
            return lines;
          },
        },
      },
    },
  };

  return (
    <div className="h-[320px] w-full">
      <Scatter data={{ datasets }} options={options} />
    </div>
  );
}
