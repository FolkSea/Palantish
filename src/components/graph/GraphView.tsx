"use client";

import { useEffect, useRef, useState } from "react";
import type { Core, ElementDefinition, StylesheetJsonBlock } from "cytoscape";
import { NODE_COLOR } from "@/lib/graph/build";
import {
  GRAPH_NODE_TYPES,
  GRAPH_TYPE_LABEL,
  type GraphData,
  type GraphNode,
  type GraphNodeType,
} from "@/lib/graph/types";
import { NEXUS_ACCENT, type Nexus } from "@/lib/badges";
import { expandNodeAction } from "@/app/graph/actions";
import Link from "next/link";
import { itemHref } from "@/lib/browse-links";

const SHAPE = {
  item: "round-rectangle",
  ioc: "ellipse",
  cve: "diamond",
  ttp: "hexagon",
  adversary: "star",
} as const;

const LAYOUT = {
  name: "cose",
  animate: false,
  fit: true,
  padding: 34,
  nodeRepulsion: 6000,
  idealEdgeLength: 90,
} as const;

function nodeColor(n: GraphNode): string {
  if (n.type === "adversary" && n.nexus)
    return NEXUS_ACCENT[n.nexus as Nexus] ?? NODE_COLOR.adversary;
  return NODE_COLOR[n.type];
}

function nodeEl(n: GraphNode): ElementDefinition {
  return {
    data: {
      id: n.id,
      label: n.label,
      type: n.type,
      color: nodeColor(n),
      rawHash: n.rawHash ?? null,
      url: n.url ?? null,
      description: n.description ?? null,
      source: n.source ?? null,
      date: n.date ?? null,
      degree: n.degree ?? 0,
    },
  };
}

function toElements(g: GraphData): ElementDefinition[] {
  return [
    ...g.nodes.map(nodeEl),
    ...g.edges.map((e) => ({ data: { id: e.id, source: e.source, target: e.target } })),
  ];
}

export default function GraphView({
  initial,
  error: initialError,
}: {
  initial: GraphData | null;
  error?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [selected, setSelected] = useState<{
    id: string;
    type: GraphNodeType;
    label: string;
    /** Set for item nodes: the report this node stands for. */
    report: { title: string; rawHash: string | null } | null;
  } | null>(null);
  const [types, setTypes] = useState<Set<GraphNodeType>>(
    () => new Set(GRAPH_NODE_TYPES),
  );
  // Read the live filter inside cy event handlers without re-binding them.
  const typesRef = useRef(types);
  useEffect(() => {
    typesRef.current = types;
  }, [types]);

  // Ring nodes whose rendered connections are fewer than their true degree - i.e.
  // they still have neighbours to expand (or a hub capped at first fetch).
  function refreshHighlights() {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().forEach((n) => {
      const total = (n.data("degree") as number) ?? 0;
      if (total > n.degree()) n.addClass("hasmore");
      else n.removeClass("hasmore");
    });
  }

  // Add a graph's new nodes/edges to the live cytoscape instance and re-layout.
  function addToGraph(g: GraphData) {
    const cy = cyRef.current;
    if (!cy) return;
    const add = toElements(g).filter((el) => cy.getElementById(el.data!.id as string).empty());
    // Even with no new nodes, expanding may raise a node's degree past its
    // rendered edges (or confirm it is fully expanded), so always refresh.
    if (add.length === 0) {
      refreshHighlights();
      return;
    }
    cy.add(add);
    cy.layout(LAYOUT).run();
    refreshHighlights();
  }

  async function expand(id: string) {
    setBusy(true);
    setError(null);
    const res = await expandNodeAction(id, [...typesRef.current]);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    addToGraph(res.graph);
  }

  useEffect(() => {
    let cy: Core | null = null;
    let disposed = false;
    (async () => {
      const cytoscape = (await import("cytoscape")).default;
      if (disposed || !containerRef.current) return;
      cy = cytoscape({
        container: containerRef.current,
        elements: initial ? toElements(initial) : [],
        style: [
          {
            selector: "node",
            style: {
              "background-color": "data(color)",
              label: "data(label)",
              color: "#0f172a",
              "font-size": 9,
              "text-wrap": "ellipsis",
              "text-max-width": "120px",
              "text-valign": "bottom",
              "text-margin-y": 3,
              width: 16,
              height: 16,
              "border-width": 1,
              "border-color": "#ffffff",
            },
          },
          ...GRAPH_NODE_TYPES.map(
            (t): StylesheetJsonBlock => ({
              selector: `node[type="${t}"]`,
              style: { shape: SHAPE[t] },
            }),
          ),
          { selector: 'node[type="item"]', style: { width: 22, height: 14 } },
          { selector: 'node[type="cve"]', style: { width: 18, height: 18 } },
          { selector: 'node[type="adversary"]', style: { width: 22, height: 22 } },
          {
            // Amber halo: this node has more connections than are drawn.
            selector: "node.hasmore",
            style: {
              "underlay-color": "#f59e0b",
              "underlay-padding": 5,
              "underlay-opacity": 0.4,
            },
          },
          {
            selector: "node:selected",
            style: { "border-width": 3, "border-color": "#1d4ed8" },
          },
          {
            selector: "edge",
            style: {
              width: 1,
              "line-color": "#cbd5e1",
              "curve-style": "bezier",
            },
          },
        ],
        layout: LAYOUT,
        wheelSensitivity: 0.2,
        minZoom: 0.2,
        maxZoom: 3,
      });
      cyRef.current = cy;

      cy.on("tap", "node", (evt) => {
        const n = evt.target;
        const d = n.data();
        setSelected({
          id: d.id,
          type: d.type,
          label: d.label,
          report:
            d.type === "item" ? { title: d.label, rawHash: d.rawHash } : null,
        });
        void expand(d.id);
      });
      cy.on("tap", (evt) => {
        if (evt.target === cy) setSelected(null);
      });

      refreshHighlights();
      setReady(true);
    })();
    return () => {
      disposed = true;
      cy?.destroy();
      cyRef.current = null;
    };
    // Seed once on mount; expansion is handled imperatively above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const empty = !initial || initial.nodes.length === 0;

  return (
    <div className="relative flex-1">
      <div ref={containerRef} className="h-full w-full" />

      <div className="absolute left-3 top-3 w-52 rounded-[10px] border border-[#e5e7eb] bg-white/95 p-3 text-[11px] shadow-sm">
        <div className="mb-1.5 font-semibold text-slate-700">Expand into</div>
        <ul className="space-y-1">
          {GRAPH_NODE_TYPES.map((t) => (
            <li key={t}>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={types.has(t)}
                  onChange={() =>
                    setTypes((prev) => {
                      const next = new Set(prev);
                      if (next.has(t)) next.delete(t);
                      else next.add(t);
                      return next;
                    })
                  }
                />
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: NODE_COLOR[t] }}
                />
                <span className="text-slate-600">{GRAPH_TYPE_LABEL[t]}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-center gap-1.5 border-t border-slate-100 pt-2 text-[10px] text-slate-500">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ boxShadow: "0 0 0 2px rgba(245,158,11,0.4)", background: "#94a3b8" }}
          />
          <span>Glowing nodes have more to expand</span>
        </div>
        <div className="mt-2 flex gap-2 border-t border-slate-100 pt-2">
          <button
            type="button"
            onClick={() => cyRef.current?.fit(undefined, 34)}
            className="rounded border border-[#e5e7eb] bg-white px-2 py-0.5 text-slate-600 hover:bg-slate-50"
          >
            Fit
          </button>
          <button
            type="button"
            onClick={() => cyRef.current?.layout(LAYOUT).run()}
            className="rounded border border-[#e5e7eb] bg-white px-2 py-0.5 text-slate-600 hover:bg-slate-50"
          >
            Re-layout
          </button>
          {busy ? <span className="ml-auto text-slate-400">Loading...</span> : null}
        </div>
      </div>

      {selected ? (
        <div className="absolute right-3 top-3 w-64 rounded-[10px] border border-[#e5e7eb] bg-white/95 p-3 text-[12px] shadow-sm">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {GRAPH_TYPE_LABEL[selected.type]}
          </div>
          <div className="break-words font-medium text-slate-800">
            {selected.label}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Tapping a node expands its depth-1 connections (filtered by the types
            on the left).
          </p>
          {selected.report?.rawHash ? (
            <Link
              href={itemHref(selected.report.rawHash)}
              className="mt-2 inline-block rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-slate-700"
            >
              Open report
            </Link>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] text-red-700">
          {error}
        </div>
      ) : null}

      {ready && empty ? (
        <div className="absolute inset-0 flex items-center justify-center text-[13px] text-slate-400">
          No report to seed the graph. Open a report and choose &ldquo;Graph&rdquo;.
        </div>
      ) : null}

    </div>
  );
}
