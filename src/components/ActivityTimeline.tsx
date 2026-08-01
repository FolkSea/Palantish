"use client";

import { useMemo, useState } from "react";
import { Scatter } from "react-chartjs-2";
import {
  Chart as ChartJS,
  LinearScale,
  TimeScale,
  PointElement,
  Tooltip,
  type ChartOptions,
  type TooltipItem,
} from "chart.js";
import "chartjs-adapter-date-fns";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { itemHref } from "@/lib/browse-links";
import {
  eventVisible,
  KIND_LABEL,
  CATEGORY_LABEL,
  POC_COLOR,
  BREACH_COLOR,
  type TimelineEvent,
  type TimelineStream,
  type TimelineCategory,
  type TimelineKind,
  type TimelineFilters,
} from "@/lib/timeline";

ChartJS.register(LinearScale, TimeScale, PointElement, Tooltip);

const DAY = 24 * 60 * 60 * 1000;

// Icon (chart point shape) per marker type.
const KIND_STYLE: Record<TimelineKind, "circle" | "rectRot" | "triangle"> = {
  report: "circle",
  breach: "rectRot", // diamond
  exploit: "triangle",
};
const KIND_RADIUS: Record<TimelineKind, number> = {
  report: 5,
  breach: 6,
  exploit: 6,
};
// Icon colour in the key: reports take the actor's colour (neutral swatch here),
// breaches are amber and PoC exploits red.
const KIND_ICON_COLOR: Record<TimelineKind, string> = {
  report: "#64748b",
  breach: BREACH_COLOR,
  exploit: POC_COLOR,
};

// Filter toggles, in display order. Breaches/Exploits gate marker kinds; the
// other three gate whole actor categories.
const TOGGLES: { key: keyof TimelineFilters; label: string }[] = [
  { key: "nation_state", label: "Nation State" },
  { key: "ecrime", label: "eCrime" },
  { key: "hacktivism", label: "Hacktivism" },
  { key: "breaches", label: "Breaches" },
  { key: "exploits", label: "Exploits" },
];

type PlotPoint = {
  x: number;
  y: number;
  title: string;
  lines: string[];
  url: string | null;
  // Enough to open the report modal (which fetches attribution by rawHash).
  description: string | null;
  source: string | null;
  date: string;
  rawHash: string | null;
};

export default function ActivityTimeline({
  events,
  streams,
  initialFilters,
}: {
  events: TimelineEvent[];
  streams: TimelineStream[];
  initialFilters: TimelineFilters;
}) {
  const [filters, setFilters] = useState<TimelineFilters>(initialFilters);
  const router = useRouter();

  function toggle(key: keyof TimelineFilters) {
    const next = { ...filters, [key]: !filters[key] };
    setFilters(next);
    // Persist to the user's profile (best-effort; same store as Focus).
    void createClient().auth.updateUser({ data: { timelineFilters: next } });
  }

  const { datasets, rowLabels, rowColors, xMin, xMax, rows, lanes } = useMemo(() => {
    const now = Date.now();
    const xMax = now + DAY / 2;
    const xMin = now - 30 * DAY;

    const visibleEvents = events.filter((e) => eventVisible(e, filters));
    const present = new Set(visibleEvents.map((e) => e.actor));
    const lanes = streams.filter((s) => present.has(s.actor));

    // Top row = first lane; y counts down so lane 0 sits at the top.
    const yOf = (actor: string) =>
      lanes.length - 1 - lanes.findIndex((s) => s.actor === actor);

    const datasets = lanes.map((lane) => {
      const laneEvents = visibleEvents.filter((e) => e.actor === lane.actor);
      const base = yOf(lane.actor);
      const data: PlotPoint[] = laneEvents.map((e) => ({
        x: new Date(`${e.date}T12:00:00Z`).getTime(),
        y: base + (Math.random() - 0.5) * 0.24,
        title: `${e.title}`,
        lines: [
          `${KIND_LABEL[e.kind]} - ${lane.actor}`,
          e.description ?? "",
          e.source ? `Source: ${e.source}` : "",
        ].filter(Boolean),
        url: e.url,
        description: e.description,
        source: e.source,
        date: e.date,
        rawHash: e.rawHash,
      }));
      return {
        label: lane.actor,
        data,
        // Breaches are always amber and PoC exploits always red (the lane's own
        // colour is red); report markers take the actor's lane colour.
        backgroundColor: laneEvents.map((e) =>
          e.kind === "breach" ? BREACH_COLOR : lane.color,
        ),
        borderColor: "#ffffff",
        borderWidth: 1,
        pointStyle: laneEvents.map((e) => KIND_STYLE[e.kind]),
        pointRadius: laneEvents.map((e) => KIND_RADIUS[e.kind]),
        pointHoverRadius: laneEvents.map((e) => KIND_RADIUS[e.kind] + 2),
      };
    });

    // Bottom-to-top order for the y-axis tick labels/colours (index === value).
    const reversed = [...lanes].reverse();
    return {
      datasets,
      rowLabels: reversed.map((s) => s.actor),
      rowColors: reversed.map((s) => s.color),
      xMin,
      xMax,
      rows: lanes.length,
      lanes,
    };
  }, [events, streams, filters]);

  const options: ChartOptions<"scatter"> = {
    responsive: true,
    maintainAspectRatio: false,
    onClick: (_evt, elements) => {
      if (!elements.length) return;
      const el = elements[0];
      const p = datasets[el.datasetIndex].data[el.index] as PlotPoint;
      // Go to the report's own page (attribution + all fields), not the source.
      if (p.rawHash) router.push(itemHref(p.rawHash));
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
        max: Math.max(rows - 0.5, 0.5),
        grid: { color: "#f1f5f9" },
        ticks: {
          font: { size: 11, weight: 600 },
          stepSize: 1,
          autoSkip: false,
          // The y-axis doubles as the actor key: each lane label in its colour.
          color: (ctx) => rowColors[ctx.index] ?? "#374151",
          callback: (value) => rowLabels[value as number] ?? "",
        },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items: TooltipItem<"scatter">[]) =>
            (items[0].raw as PlotPoint).title,
          label: (item: TooltipItem<"scatter">) =>
            (item.raw as PlotPoint).lines,
        },
      },
    },
  };

  const height = Math.max(220, rows * 30 + 64);

  return (
    <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-4">
      <h2 className="text-[13px] font-semibold text-slate-900">
        Activity timeline (last 30 days)
      </h2>
      <p className="mt-0.5 text-[11px] text-slate-500">
        One lane per adversary; shape denotes the record type. Red marks PoC
        exploits and amber breaches; reports take the actor colour (grey when
        unattributed). Click a point to open the report.
      </p>

      <div className="mt-3 flex flex-col gap-4 sm:flex-row">
        <KeyPanel lanes={lanes} />
        <div className="min-w-0 flex-1">
          {rows > 0 ? (
            <div style={{ height }} className="w-full">
              <Scatter data={{ datasets }} options={options} />
            </div>
          ) : (
            <p className="py-10 text-center text-[12px] text-slate-400">
              Nothing matches the current filters.
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
        <span className="mr-1 text-[11px] font-medium text-slate-500">
          Show
        </span>
        {TOGGLES.map((t) => {
          const on = filters[t.key];
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(t.key)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                on
                  ? "border-[#2855D9] bg-[#2855D9] text-white"
                  : "border-[#e5e7eb] bg-white text-slate-400 hover:text-slate-600"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

    </section>
  );
}

/**
 * Left-hand key: the colour of each visible actor lane (grouped by category)
 * and the shape used for each record type. Lanes arrive pre-sorted by category,
 * so a header is emitted whenever the category changes.
 */
function KeyPanel({ lanes }: { lanes: TimelineStream[] }) {
  const groups: { category: TimelineCategory; lanes: TimelineStream[] }[] = [];
  for (const lane of lanes) {
    const last = groups[groups.length - 1];
    if (last && last.category === lane.category) last.lanes.push(lane);
    else groups.push({ category: lane.category, lanes: [lane] });
  }

  return (
    <aside className="shrink-0 rounded-[8px] border border-[#e5e7eb] bg-slate-50 p-3 text-[11px] sm:w-[168px]">
      <div className="mb-1 font-semibold uppercase tracking-wide text-slate-400">
        Actors
      </div>
      {groups.length ? (
        <div className="space-y-2">
          {groups.map((g) => (
            <div key={g.category}>
              <div className="text-[10px] font-medium text-slate-500">
                {CATEGORY_LABEL[g.category]}
              </div>
              <ul className="mt-0.5 space-y-0.5">
                {g.lanes.map((lane) => (
                  <li key={lane.actor} className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: lane.color }}
                    />
                    <span className="truncate text-slate-700" title={lane.actor}>
                      {lane.actor}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-slate-400">No lanes shown.</p>
      )}

      <div className="mt-3 mb-1 font-semibold uppercase tracking-wide text-slate-400">
        Record type
      </div>
      <ul className="space-y-0.5">
        {(["report", "breach", "exploit"] as TimelineKind[]).map((kind) => (
          <li key={kind} className="flex items-center gap-1.5 text-slate-700">
            <ShapeIcon kind={kind} color={KIND_ICON_COLOR[kind]} />
            {kind === "exploit" ? "Exploit (PoC)" : KIND_LABEL[kind]}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function ShapeIcon({ kind, color }: { kind: TimelineKind; color?: string }) {
  const fill = color ?? "#64748b";
  if (kind === "report")
    return (
      <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r="4.5" fill={fill} />
      </svg>
    );
  if (kind === "breach")
    return (
      <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
        <rect x="6" y="0.5" width="7.8" height="7.8" fill={fill} transform="rotate(45 6 6)" />
      </svg>
    );
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1 L11 10.5 L1 10.5 Z" fill={fill} />
    </svg>
  );
}
