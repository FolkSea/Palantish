"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Core, ElementDefinition, StylesheetJsonBlock } from "cytoscape";
import { NODE_COLOR } from "@/lib/graph/build";
import {
  GRAPH_NODE_TYPES,
  GRAPH_TYPE_LABEL,
  IOC_SUBTYPE_LABEL,
  IOC_SUBTYPES,
  type GraphData,
  type GraphNode,
  type GraphNodeType,
} from "@/lib/graph/types";
import { iconFor } from "@/lib/graph/icons";
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
      iocSubtype: n.iocSubtype ?? null,
      icon: iconFor(n.type, n.iocSubtype),
    },
  };
}

// What a right-click can pull in. Each is a node type, optionally narrowed to
// IOC subtypes - an analyst thinks "show me the IPs", not "show me the IOCs of
// subtype ip".
export type ExpandTarget = {
  key: string;
  label: string;
  types: GraphNodeType[];
  subtypes?: string[];
};

const EXPAND_TARGETS: ExpandTarget[] = [
  ...IOC_SUBTYPES.map((st) => ({
    key: `ioc:${st}`,
    label: IOC_SUBTYPE_LABEL[st],
    types: ["ioc"] as GraphNodeType[],
    subtypes: [st],
  })),
  { key: "cve", label: GRAPH_TYPE_LABEL.cve, types: ["cve"] },
  { key: "ttp", label: GRAPH_TYPE_LABEL.ttp, types: ["ttp"] },
  { key: "adversary", label: GRAPH_TYPE_LABEL.adversary, types: ["adversary"] },
  { key: "item", label: "Reports", types: ["item"] },
  { key: "all", label: "Everything", types: [...GRAPH_NODE_TYPES] },
];

// How far one expand may reach. The caps matter more than the depth: a hub at
// depth 3 is thousands of nodes, and an unbounded walk would hang the browser
// long before it finished being useful.
const DEPTH_OPTIONS = [1, 2, 3, 4, 5, Infinity];
const MAX_NODES = 1200;
const MAX_REQUESTS = 300;

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
  const [depth, setDepth] = useState<number>(1);
  const depthRef = useRef(depth);
  useEffect(() => {
    depthRef.current = depth;
  }, [depth]);
  // Right-click menu: which node, and where to draw it.
  const [menu, setMenu] = useState<{
    nodeId: string;
    label: string;
    x: number;
    y: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Keep the menu inside the canvas. A node near the bottom or right edge - and
  // the interesting ones often are, since expansion pushes new nodes outwards -
  // would otherwise open a menu with half its options past the viewport, with no
  // way to scroll to them.
  useLayoutEffect(() => {
    const el = menuRef.current;
    const box = containerRef.current;
    if (!menu || !el || !box) return;
    const gap = 6;
    const edge = 4;
    const left = Math.max(
      edge,
      Math.min(menu.x + gap, box.clientWidth - el.offsetWidth - edge),
    );
    const top = Math.max(
      edge,
      Math.min(menu.y + gap, box.clientHeight - el.offsetHeight - edge),
    );
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [menu]);

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

  /**
   * Add a graph's new elements and return the ids of nodes that were not
   * already drawn. Does not lay out: a multi-hop expand merges many results and
   * one layout at the end is the difference between smooth and unusable.
   */
  function mergeGraph(g: GraphData): string[] {
    const cy = cyRef.current;
    if (!cy) return [];
    const fresh = toElements(g).filter((el) =>
      cy.getElementById(el.data!.id as string).empty(),
    );
    if (fresh.length) cy.add(fresh);
    return fresh
      .filter((el) => !("source" in (el.data ?? {})))
      .map((el) => el.data!.id as string);
  }

  // Add a graph's new nodes/edges to the live cytoscape instance and re-layout.
  function addToGraph(g: GraphData) {
    const cy = cyRef.current;
    if (!cy) return;
    const added = mergeGraph(g);
    // Even with no new nodes, expanding may raise a node's degree past its
    // rendered edges (or confirm it is fully expanded), so always refresh.
    if (added.length) cy.layout(LAYOUT).run();
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

  /**
   * Expand outward from one node, following only `target`, up to `depth` hops.
   *
   * "item" is always included in the traversal even when the target is, say,
   * IPs: the graph alternates report <-> entity, so an entity's only neighbours
   * are reports and excluding them would make every multi-hop walk stop dead
   * after one step.
   */
  async function expandFrom(rootId: string, target: ExpandTarget, depth: number) {
    const cy = cyRef.current;
    if (!cy) return;
    setBusy(true);
    setError(null);

    const types = [...new Set<GraphNodeType>([...target.types, "item"])];
    let frontier = [rootId];
    const visited = new Set<string>([rootId]);
    let requests = 0;
    let capped = false;
    let level = 0;

    while (frontier.length && level < depth) {
      const next: string[] = [];
      for (const id of frontier) {
        if (requests >= MAX_REQUESTS || cy.nodes().length >= MAX_NODES) {
          capped = true;
          break;
        }
        requests += 1;
        const res = await expandNodeAction(id, types, target.subtypes);
        if (!res.ok) {
          setError(res.error);
          setBusy(false);
          cy.layout(LAYOUT).run();
          return;
        }
        for (const addedId of mergeGraph(res.graph)) {
          if (visited.has(addedId)) continue;
          visited.add(addedId);
          next.push(addedId);
        }
      }
      if (capped) break;
      frontier = next;
      level += 1;
    }

    cy.layout(LAYOUT).run();
    refreshHighlights();
    setBusy(false);
    if (capped) {
      setError(
        `Stopped at ${cy.nodes().length} nodes - narrow the expansion or use fewer levels.`,
      );
    }
  }

  useEffect(() => {
    let cy: Core | null = null;
    let observer: ResizeObserver | null = null;
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
              width: 26,
              height: 26,
              "border-width": 1,
              "border-color": "#ffffff",
              // The glyph rides on the node's own colour, so the type reads
              // from the shape at a glance and from the icon up close.
              "background-image": "data(icon)",
              "background-fit": "contain",
              "background-width": "62%",
              "background-height": "62%",
              "background-clip": "none",
            },
          },
          ...GRAPH_NODE_TYPES.map(
            (t): StylesheetJsonBlock => ({
              selector: `node[type="${t}"]`,
              style: { shape: SHAPE[t] },
            }),
          ),
          // Room for the glyph: the diamond and star inscribe a smaller square
          // than the rectangle does, so they need more box for the same icon.
          { selector: 'node[type="item"]', style: { width: 32, height: 24 } },
          { selector: 'node[type="cve"]', style: { width: 34, height: 34 } },
          { selector: 'node[type="ttp"]', style: { width: 30, height: 30 } },
          { selector: 'node[type="adversary"]', style: { width: 34, height: 34 } },
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
        if (evt.target === cy) {
          setSelected(null);
          setMenu(null);
        }
      });

      // Right-click a node to choose what to pull in, rather than taking
      // whatever the checkbox filter happens to be set to.
      cy.on("cxttap", "node", (evt) => {
        const d = evt.target.data();
        const pos = evt.renderedPosition ?? { x: 0, y: 0 };
        setMenu({ nodeId: d.id, label: d.label, x: pos.x, y: pos.y });
      });
      cy.on("cxttap", (evt) => {
        if (evt.target === cy) setMenu(null);
      });
      // Panning or zooming leaves the menu pointing at empty space.
      cy.on("pan zoom", () => setMenu(null));

      refreshHighlights();
      setReady(true);

      // Cytoscape measures its container once, at construction. Anything that
      // changes that box afterwards - the page header laying out, a window
      // resize, the pane being revealed - leaves it drawing to a stale viewport,
      // with the graph bunched into a corner until something calls fit().
      if (containerRef.current) {
        observer = new ResizeObserver(() => {
          cy?.resize();
          cy?.fit(undefined, 34);
        });
        observer.observe(containerRef.current);
      }
    })();
    return () => {
      disposed = true;
      observer?.disconnect();
      cy?.destroy();
      cyRef.current = null;
    };
    // Seed once on mount; expansion is handled imperatively above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const empty = !initial || initial.nodes.length === 0;

  return (
    <div className="relative flex-1">
      <div
        ref={containerRef}
        className="h-full w-full"
        // Suppress the browser's own menu over the canvas: without this it
        // opens on top of ours and right-click is unusable.
        onContextMenu={(e) => e.preventDefault()}
      />

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
        <label className="mt-2 flex items-center gap-2 border-t border-slate-100 pt-2">
          <span className="text-slate-600">Levels</span>
          <select
            value={String(depth)}
            onChange={(e) => setDepth(Number(e.target.value))}
            className="rounded border border-[#e5e7eb] bg-white px-1.5 py-0.5 text-[11px] text-slate-700 outline-none focus:border-slate-400"
          >
            {DEPTH_OPTIONS.map((d) => (
              <option key={String(d)} value={String(d)}>
                {d === Infinity ? "\u221e (all)" : d}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-1 text-[10px] leading-tight text-slate-400">
          How far a right-click expand reaches. Stops at {MAX_NODES} nodes.
        </p>

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

      {menu ? (
        <div
          ref={menuRef}
          className="absolute z-30 w-52 overflow-hidden rounded-md border border-[#e5e7eb] bg-white py-1 text-[11px] shadow-lg"
          // Placed here, then clamped into the canvas by the layout effect above.
          style={{ left: menu.x + 6, top: menu.y + 6 }}
          onMouseLeave={() => setMenu(null)}
        >
          <div className="truncate border-b border-slate-100 px-2.5 pb-1 pt-0.5 text-[10px] text-slate-400">
            {menu.label}
          </div>
          {EXPAND_TARGETS.map((t) => (
            <button
              key={t.key}
              type="button"
              disabled={busy}
              onClick={() => {
                const node = menu.nodeId;
                setMenu(null);
                void expandFrom(node, t, depthRef.current);
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <span className="text-slate-400">Expand</span>
              {t.label}
            </button>
          ))}
        </div>
      ) : null}

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
