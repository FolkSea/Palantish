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

ChartJS.register(LinearScale, TimeScale, PointElement, Tooltip, Legend);

export type ScatterPoint = {
  x: number; // epoch ms
  category: string;
  title: string;
  lines: string[];
  url: string | null;
};

type InternalPoint = ScatterPoint & { y: number };

const DAY = 24 * 60 * 60 * 1000;

/**
 * Generic categorical time scatter: X = date over the last `days` days, Y =
 * discrete category rows, one coloured dataset per category. Clicking a point
 * opens its source URL.
 */
export default function CategoryScatter({
  points,
  categories,
  colors,
  days = 30,
  height = 320,
}: {
  points: ScatterPoint[];
  categories: string[];
  colors: Record<string, string>;
  days?: number;
  height?: number;
}) {
  const { datasets, xMin, xMax } = useMemo(() => {
    const now = Date.now();
    const xMax = now + DAY / 2;
    const xMin = now - days * DAY;
    // Top row = first category; index counts down so the first sits at the top.
    const yOf = (cat: string) => categories.length - 1 - categories.indexOf(cat);

    const datasets = categories.map((cat) => {
      const base = yOf(cat);
      const data: InternalPoint[] = points
        .filter((p) => p.category === cat)
        .map((p) => ({ ...p, y: base + (Math.random() - 0.5) * 0.24 }));
      const color = colors[cat] ?? "#475569";
      return {
        label: cat,
        data,
        backgroundColor: color,
        borderColor: color,
        pointRadius: 5,
        pointHoverRadius: 7,
      };
    });
    return { datasets, xMin, xMax };
  }, [points, categories, colors, days]);

  const rowLabels = useMemo(() => [...categories].reverse(), [categories]);

  const options: ChartOptions<"scatter"> = {
    responsive: true,
    maintainAspectRatio: false,
    onClick: (_evt, elements) => {
      if (!elements.length) return;
      const el = elements[0];
      const p = datasets[el.datasetIndex].data[el.index] as InternalPoint;
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
        max: categories.length - 0.5,
        grid: { color: "#f1f5f9" },
        ticks: {
          color: "#374151",
          font: { size: 11 },
          stepSize: 1,
          autoSkip: false,
          callback: (value) => rowLabels[value as number] ?? "",
        },
      },
    },
    plugins: {
      legend: {
        position: "bottom",
        labels: { boxWidth: 10, font: { size: 11 }, color: "#374151" },
      },
      tooltip: {
        callbacks: {
          title: (items: TooltipItem<"scatter">[]) =>
            (items[0].raw as InternalPoint).title,
          label: (item: TooltipItem<"scatter">) =>
            (item.raw as InternalPoint).lines,
        },
      },
    },
  };

  return (
    <div style={{ height }} className="w-full">
      <Scatter data={{ datasets }} options={options} />
    </div>
  );
}
