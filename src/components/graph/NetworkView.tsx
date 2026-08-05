"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Core, ElementDefinition } from "cytoscape";
import Link from "next/link";
import { NODE_COLOR, parseNodeId } from "@/lib/graph/build";
import {
  sharedEntitiesAction,
  type SharedEntity,
} from "@/app/network/actions";
import { edgeWidth } from "@/lib/graph/network";
import {
  sliceNetwork,
  DEFAULT_MIN_STRENGTH,
  type NetworkSlice,
} from "@/lib/graph/clusters";
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

/**
 * Show what the slice keeps, hide the rest, and paint each survivor its
 * cluster's colour.
 */
function applySlice(cy: Core, slice: NetworkSlice): void {
  cy.batch(() => {
    cy.elements().forEach((el) => {
      const id = el.id();
      const shown = slice.nodeIds.has(id) || slice.edgeIds.has(id);
      el.style("display", shown ? "element" : "none");
      const color = slice.colorOf.get(id);
      if (shown && color) el.data("clusterColor", color);
    });
  });
}

/** Fit the view to whatever is currently drawn. */
function refit(cy: Core): void {
  const shown = cy.elements().filter((el) => el.style("display") !== "none");
  if (shown.nonempty()) cy.fit(shown, 40);
  else cy.fit(undefined, 40);
}

// Headings for the shared-indicator list, by the raw iocs.ioc_type.
const SHARED_GROUP_LABEL: Record<string, string> = {
  cve: "CVEs",
  mitre: "Techniques (ATT&CK)",
  ip: "IP addresses",
  domain: "Domains",
  uri: "URLs",
  file_hash: "File hashes",
};

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
  // The indicators behind the selected connection, fetched on click.
  const [shared, setShared] = useState<{
    /** Which connection these belong to, so a slow reply cannot land in a
     * panel the user has already moved on from. */
    edgeId: string;
    entities: SharedEntity[];
    truncated: boolean;
    error: string | null;
  } | null>(null);
  const [sharedPending, setSharedPending] = useState(false);
  const [minStrength, setMinStrength] = useState(DEFAULT_MIN_STRENGTH);

  const maxWeight = useMemo(
    () => graph?.edges.reduce((m, e) => Math.max(m, e.weight ?? 1), 1) ?? 1,
    [graph],
  );

  // What is on the canvas at this threshold, and which cluster each survivor
  // belongs to. One answer, used for both the picture and the panel beside it.
  const slice = useMemo(() => sliceNetwork(graph, minStrength), [graph, minStrength]);
  // The canvas is built once, asynchronously; by the time it settles the slice
  // is whatever the reader has since chosen, so the layout reads it from here
  // rather than closing over the value it started with.
  const sliceRef = useRef(slice);

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
            clusterColor: nodeColor(n),
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
            clusterColor: "#cbd5e1",
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
              // Cluster colour, not type colour: which structure a node belongs
              // to is the question here, and shape already says what it is.
              "background-color": "data(clusterColor)",
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
              "line-color": "data(clusterColor)",
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
      // Laid out in full, then filtered: the threshold changes as the reader
      // moves the slider, and a layout computed from one setting of it would
      // scatter every node the moment they did.
      const layout = cy.layout(LAYOUT);
      layout.one("layoutstop", () => {
        const settled = cyRef.current;
        if (!settled) return;
        packComponents(settled);
        applySlice(settled, sliceRef.current);
        refit(settled);
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
        // The strength alone says how related two reports are; which indicators
        // they share says why, and that is the question an analyst actually has.
        setShared(null);
        setSharedPending(true);
        const edgeId = d.id as string;
        void sharedEntitiesAction(
          parseNodeId(d.source as string).key,
          parseNodeId(d.target as string).key,
        )
          .then((res) => {
            setShared(
              res.ok
                ? { edgeId, entities: res.entities, truncated: res.truncated, error: null }
                : { edgeId, entities: [], truncated: false, error: res.error },
            );
          })
          .finally(() => setSharedPending(false));
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
  // filters what is already drawn rather than refetching. Raising the
  // threshold splits clusters as their weakest links go, so the colours are
  // reassigned in the same pass - otherwise two halves of a broken cluster
  // would go on sharing a colour and read as one.
  useEffect(() => {
    sliceRef.current = slice;
    const cy = cyRef.current;
    if (!cy) return;
    applySlice(cy, slice);
    // Positions are deliberately left alone - a node staying put as the
    // threshold moves is what lets you follow one cluster - but the survivors
    // are scattered across the old extent, so the view has to close in on them
    // or a strict threshold looks like an almost empty canvas.
    refit(cy);
  }, [slice]);

  // Zoom and pan are the two things a reader loses track of on a graph this
  // size; getting back to the whole picture should not mean reloading the page.
  function refitNow() {
    const cy = cyRef.current;
    if (cy) refit(cy);
  }

  const empty = !graph || graph.nodes.length === 0;
  // The canvas can be empty while the graph is not: the threshold opens at 3,
  // and on a small corpus that can hide everything. Saying so beats a blank
  // page that reads as "no data".
  const emptyAtThreshold = !empty && slice.nodeIds.size === 0;

  // Group the shared indicators for display, keeping the order the server sent
  // (CVEs and techniques first, then network indicators, then hashes).
  const sharedGroups = useMemo(() => {
    if (!shared || shared.edgeId !== selected?.node.id) return null;
    const groups: { key: string; label: string; items: SharedEntity[] }[] = [];
    for (const e of shared.entities) {
      const label = SHARED_GROUP_LABEL[e.iocType] ?? e.iocType;
      const last = groups[groups.length - 1];
      if (last && last.key === e.iocType) last.items.push(e);
      else groups.push({ key: e.iocType, label, items: [e] });
    }
    return groups;
  }, [shared, selected]);

  return (
    <div className="relative flex-1">
      <div ref={containerRef} className="h-full w-full" />

      <div className="absolute left-3 top-3 w-56 rounded-[10px] border border-[#e5e7eb] bg-white/95 p-3 text-[11px] shadow-sm">
        <div className="mb-1.5 font-semibold text-slate-700">Report network</div>
        {/* Counted from what is drawn, not from what was loaded: at a
            threshold of 3 those are very different numbers, and the one worth
            showing is the one on the screen. */}
        <dl className="space-y-0.5 text-slate-600">
          <div className="flex justify-between">
            <dt>Reports</dt>
            <dd className="font-medium text-slate-800">{slice.reports}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Actors</dt>
            <dd className="font-medium text-slate-800">{slice.actors}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Connections</dt>
            <dd className="font-medium text-slate-800">{slice.links}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Clusters</dt>
            <dd className="font-medium text-slate-800">{slice.clusters}</dd>
          </div>
        </dl>

        <label className="mt-3 block">
          <span className="text-slate-700">
            Min strength: <span className="font-medium">{minStrength}</span>
          </span>
          <input
            type="range"
            min={1}
            max={Math.max(DEFAULT_MIN_STRENGTH, Math.min(maxWeight, 40))}
            value={minStrength}
            onChange={(e) => setMinStrength(Number(e.target.value))}
            className="mt-1 w-full"
          />
        </label>
        <button
          type="button"
          onClick={refitNow}
          className="mt-2 w-full rounded-md border border-[#e5e7eb] bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
        >
          Refit graph
        </button>

        <p className="mt-2 text-[10px] leading-tight text-slate-400">
          A connection&apos;s strength is how many indicators the two reports
          share; thicker means more. Each cluster has its own colour. Dashed
          amber ties a report to its actor.
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

              {sharedPending ? (
                <p className="mt-2 text-[11px] text-slate-400">
                  Loading shared indicators...
                </p>
              ) : null}

              {shared?.error ? (
                <p className="mt-2 text-[11px] text-rose-600">{shared.error}</p>
              ) : null}

              {sharedGroups ? (
                <div className="mt-2 max-h-[46vh] overflow-y-auto border-t border-slate-100 pt-2">
                  {sharedGroups.map((g) => (
                    <div key={g.key} className="mb-2 last:mb-0">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        {g.label} ({g.items.length})
                      </div>
                      <ul className="mt-0.5 space-y-0.5">
                        {g.items.map((e) => (
                          <li
                            key={`${e.iocType}:${e.value}`}
                            // Indicators are long and must not be re-flowed into
                            // something that reads as a different value.
                            className="break-all font-mono text-[10.5px] leading-snug text-slate-700"
                          >
                            {e.value}
                            {e.name ? (
                              <span className="ml-1 font-sans text-slate-400">
                                {e.name}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  {shared?.truncated ? (
                    <p className="mt-1 text-[10px] text-slate-400">
                      Showing the first {sharedGroups.reduce((n, g) => n + g.items.length, 0)}{" "}
                      of {selected.link.weight}.
                    </p>
                  ) : null}
                </div>
              ) : null}
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
                      Zoom to Cluster
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

      {emptyAtThreshold ? (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-[12px] text-slate-500">
          No connection is worth {minStrength} shared indicators. Lower the
          minimum strength to see the weaker ones.
        </div>
      ) : null}
    </div>
  );
}
