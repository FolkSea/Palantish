"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Core, ElementDefinition } from "cytoscape";
import Link from "next/link";
import { NODE_COLOR } from "@/lib/graph/build";
import { edgeWidth } from "@/lib/graph/network";
import type { GraphData, GraphNode } from "@/lib/graph/types";
import { NEXUS_ACCENT, type Nexus } from "@/lib/badges";
import { itemHref } from "@/lib/browse-links";
import { iconFor } from "@/lib/graph/icons";

// Nodes are pushed further apart than in the seeded graph: this one opens with
// hundreds of them at once, and the seeded spacing packs them into a disc too
// dense to read.
const LAYOUT = {
  name: "cose",
  animate: false,
  fit: true,
  padding: 40,
  nodeRepulsion: 24000,
  idealEdgeLength: 70,
  edgeElasticity: 120,
  // Most of this graph is small separate clusters - pairs and triples of
  // reports - and cose packs disconnected components in a row. Without spacing
  // between them they run together into an unreadable strip; with gravity they
  // stay compact instead of drifting apart.
  componentSpacing: 160,
  gravity: 70,
  nodeOverlap: 16,
  // The default (~100) leaves a graph this size half-settled.
  numIter: 1500,
} as const;

/**
 * Arrange disconnected clusters in a grid.
 *
 * cose packs components along a single row, so a graph that is mostly small
 * clusters - this one is - comes out as a strip thousands of pixels wide and a
 * few hundred tall. Fitting that to the viewport shrinks every node to a speck.
 * Re-packing into a roughly square grid costs one pass over the components and
 * makes the difference between readable and not.
 */
function packComponents(cy: Core): void {
  const comps = cy.elements().components();
  if (comps.length < 2) return;

  const boxes = comps
    .map((c) => ({ c, bb: c.boundingBox() }))
    .sort((a, b) => b.c.nodes().length - a.c.nodes().length);

  const GAP = 70;
  const area = boxes.reduce((s, b) => s + (b.bb.w + GAP) * (b.bb.h + GAP), 0);
  // Slightly wider than tall, matching the shape of a browser viewport.
  const targetWidth = Math.sqrt(area) * 1.3;

  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const { c, bb } of boxes) {
    if (x > 0 && x + bb.w > targetWidth) {
      x = 0;
      y += rowHeight + GAP;
      rowHeight = 0;
    }
    const dx = x - bb.x1;
    const dy = y - bb.y1;
    c.nodes().positions((n) => ({
      x: n.position("x") + dx,
      y: n.position("y") + dy,
    }));
    x += bb.w + GAP;
    rowHeight = Math.max(rowHeight, bb.h);
  }
  cy.fit(undefined, 40);
}

function nodeColor(n: GraphNode): string {
  if (n.type === "adversary" && n.nexus)
    return NEXUS_ACCENT[n.nexus as Nexus] ?? NODE_COLOR.adversary;
  return NODE_COLOR[n.type];
}

export default function NetworkView({
  graph,
  error: initialError,
}: {
  graph: GraphData | null;
  error?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [selected, setSelected] = useState<{
    node: GraphNode;
    /** For a connection: the two reports and how much they share. */
    link: { a: string; b: string; weight: number } | null;
  } | null>(null);
  const [minStrength, setMinStrength] = useState(1);

  const maxWeight = useMemo(
    () => graph?.edges.reduce((m, e) => Math.max(m, e.weight ?? 1), 1) ?? 1,
    [graph],
  );

  useEffect(() => {
    let cy: Core | null = null;
    let observer: ResizeObserver | null = null;
    let disposed = false;
    (async () => {
      const cytoscape = (await import("cytoscape")).default;
      if (disposed || !containerRef.current || !graph) return;

      const elements: ElementDefinition[] = [
        ...graph.nodes.map((n) => ({
          data: {
            id: n.id,
            label: n.label,
            type: n.type,
            color: nodeColor(n),
            icon: iconFor(n.type, n.iocSubtype),
          },
        })),
        ...graph.edges.map((e) => ({
          data: {
            id: e.id,
            source: e.source,
            target: e.target,
            weight: e.weight ?? 1,
            width: edgeWidth(e.weight ?? 1, maxWeight),
            // Actor edges are membership, not shared evidence, so they are drawn
            // as a thin dashed tie and never carry a strength.
            kind: e.weight === undefined ? "actor" : "shared",
          },
        })),
      ];

      cy = cytoscape({
        container: containerRef.current,
        elements,
        style: [
          {
            selector: "node",
            style: {
              "background-color": "data(color)",
              "background-image": "data(icon)",
              "background-fit": "contain",
              "background-width": "62%",
              "background-height": "62%",
              "background-clip": "none",
              width: 26,
              height: 26,
              shape: "round-rectangle",
              label: "data(label)",
              "font-size": 7,
              color: "#334155",
              "text-valign": "bottom",
              "text-margin-y": 3,
              "text-max-width": "90px",
              "text-wrap": "ellipsis",
            },
          },
          {
            selector: 'node[type = "item"]',
            style: { width: 30, height: 22 },
          },
          {
            selector: 'node[type = "adversary"]',
            style: { width: 34, height: 34, shape: "star", "font-size": 9 },
          },
          {
            selector: "edge",
            style: {
              width: "data(width)",
              "line-color": "#cbd5e1",
              "curve-style": "haystack",
              opacity: 0.75,
            },
          },
          {
            selector: 'edge[kind = "actor"]',
            style: {
              "line-color": "#fbbf24",
              "line-style": "dashed",
              "curve-style": "bezier",
              width: 1,
            },
          },
          {
            selector: "node:selected",
            style: { "border-width": 3, "border-color": "#0f172a" },
          },
          {
            selector: "edge:selected",
            style: { "line-color": "#0f172a", opacity: 1 },
          },
        ],
        wheelSensitivity: 0.2,
      });
      cyRef.current = cy;

      // Run the layout here rather than in the constructor so the components can
      // be re-packed once it has settled.
      const layout = cy.layout(LAYOUT);
      layout.one("layoutstop", () => {
        if (cyRef.current) packComponents(cyRef.current);
      });
      layout.run();

      const labelOf = (id: string) => cy?.getElementById(id).data("label") ?? id;
      cy.on("tap", "node", (evt) => {
        const d = evt.target.data();
        const node = graph.nodes.find((n) => n.id === d.id);
        if (node) setSelected({ node, link: null });
      });
      cy.on("tap", "edge", (evt) => {
        const d = evt.target.data();
        if (d.kind === "actor") return;
        setSelected({
          node: {
            id: d.id,
            type: "item",
            label: "Connection",
          },
          link: {
            a: labelOf(d.source),
            b: labelOf(d.target),
            weight: d.weight,
          },
        });
      });
      cy.on("tap", (evt) => {
        if (evt.target === cy) setSelected(null);
      });

      // Cytoscape measures its container once, at construction; anything that
      // changes that box afterwards leaves it drawing to a stale viewport.
      observer = new ResizeObserver(() => {
        cy?.resize();
        cy?.fit(undefined, 40);
      });
      observer.observe(containerRef.current);
    })();
    return () => {
      disposed = true;
      observer?.disconnect();
      cy?.destroy();
      cyRef.current = null;
    };
    // Built once from the server-rendered graph; the filter below only hides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hiding weak connections is the main way to read a graph this dense, so it
  // filters what is already drawn rather than refetching.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.edges().forEach((e) => {
        const w = e.data("weight") ?? 1;
        const hide = e.data("kind") === "shared" && w < minStrength;
        e.style("display", hide ? "none" : "element");
      });
      cy.nodes().forEach((n) => {
        const visible = n
          .connectedEdges()
          .some((e) => e.style("display") !== "none");
        n.style("display", visible ? "element" : "none");
      });
    });
    // Positions are deliberately left alone - a node staying put as the
    // threshold moves is what lets you follow one cluster - but the survivors
    // are scattered across the old extent, so the view has to close in on them
    // or a strict threshold looks like an almost empty canvas.
    const shown = cy.elements().filter((el) => el.style("display") !== "none");
    if (shown.nonempty()) cy.fit(shown, 40);
  }, [minStrength]);

  const counts = useMemo(() => {
    const reports = graph?.nodes.filter((n) => n.type === "item").length ?? 0;
    const actors = graph?.nodes.filter((n) => n.type === "adversary").length ?? 0;
    const links = graph?.edges.filter((e) => e.weight !== undefined).length ?? 0;
    return { reports, actors, links };
  }, [graph]);

  const empty = !graph || graph.nodes.length === 0;

  return (
    <div className="relative flex-1">
      <div ref={containerRef} className="h-full w-full" />

      <div className="absolute left-3 top-3 w-56 rounded-[10px] border border-[#e5e7eb] bg-white/95 p-3 text-[11px] shadow-sm">
        <div className="mb-1.5 font-semibold text-slate-700">Report network</div>
        <dl className="space-y-0.5 text-slate-600">
          <div className="flex justify-between">
            <dt>Reports</dt>
            <dd className="font-medium text-slate-800">{counts.reports}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Actors</dt>
            <dd className="font-medium text-slate-800">{counts.actors}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Connections</dt>
            <dd className="font-medium text-slate-800">{counts.links}</dd>
          </div>
        </dl>

        <label className="mt-3 block">
          <span className="text-slate-700">
            Min strength: <span className="font-medium">{minStrength}</span>
          </span>
          <input
            type="range"
            min={1}
            max={Math.max(2, Math.min(maxWeight, 40))}
            value={minStrength}
            onChange={(e) => setMinStrength(Number(e.target.value))}
            className="mt-1 w-full"
          />
        </label>
        <p className="mt-1 text-[10px] leading-tight text-slate-400">
          A connection&apos;s strength is how many indicators the two reports
          share; thicker means more. Dashed amber ties a report to its actor.
        </p>
      </div>

      {selected ? (
        <div className="absolute right-3 top-3 w-64 rounded-[10px] border border-[#e5e7eb] bg-white/95 p-3 text-[12px] shadow-sm">
          {selected.link ? (
            <>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Connection - strength {selected.link.weight}
              </div>
              <p className="text-slate-700">{selected.link.a}</p>
              <p className="my-1 text-center text-slate-400">and</p>
              <p className="text-slate-700">{selected.link.b}</p>
              <p className="mt-2 text-[11px] text-slate-500">
                They share {selected.link.weight} indicator
                {selected.link.weight === 1 ? "" : "s"}. Open either report to
                see which.
              </p>
            </>
          ) : (
            <>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {selected.node.type === "adversary" ? "Adversary" : "Report"}
              </div>
              <div className="break-words font-medium text-slate-800">
                {selected.node.label}
              </div>
              {selected.node.type === "item" ? (
                <div className="mt-2 flex gap-2">
                  {selected.node.rawHash ? (
                    <Link
                      href={itemHref(selected.node.rawHash)}
                      className="rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-slate-700"
                    >
                      Open report
                    </Link>
                  ) : null}
                  {selected.node.rawHash ? (
                    <Link
                      href={`/graph?seed=${selected.node.rawHash}`}
                      className="rounded-md border border-[#e5e7eb] px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Seed link analysis
                    </Link>
                  ) : null}
                </div>
              ) : (
                <p className="mt-1 text-[11px] text-slate-500">
                  Reports attributed to this actor, tied by the dashed edges.
                </p>
              )}
            </>
          )}
        </div>
      ) : null}

      {initialError ? (
        <div className="absolute inset-x-0 bottom-3 mx-auto w-fit rounded-md bg-rose-50 px-3 py-1.5 text-[11px] text-rose-700">
          {initialError}
        </div>
      ) : null}

      {empty && !initialError ? (
        <div className="absolute inset-0 flex items-center justify-center text-[12px] text-slate-500">
          No connected reports yet - indicators have to appear in more than one
          report before a connection exists.
        </div>
      ) : null}
    </div>
  );
}
