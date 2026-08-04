// Glyphs for graph nodes, as inline SVG data URIs.
//
// Inline rather than files: cytoscape takes a background-image URL, and a data
// URI keeps the icon set with the code, needs no network round trip per node,
// and cannot 404 on a node that is already drawn. White strokes, because the
// glyph sits on the node's own colour.

import type { GraphNodeType, IocSubtype } from "./types";

/** A node's icon key: its type, or for an IOC, its subtype. */
export type IconKey = Exclude<GraphNodeType, "ioc"> | IocSubtype;

// 24x24 viewBox, stroke-only, so one set works at any node size.
const PATHS: Record<IconKey, string> = {
  // A document with a folded corner: a report.
  item: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
  // A network interface card: a board with a bracket and port pins.
  ip: '<rect x="2" y="7" width="20" height="10" rx="1"/><path d="M6 17v3M6 4v3"/><path d="M10 11h2M14 11h2M10 13.5h2M14 13.5h2"/>',
  // A rack server: stacked units with drive lights - a host, i.e. a domain.
  domain: '<rect x="3" y="4" width="18" height="7" rx="1"/><rect x="3" y="13" width="18" height="7" rx="1"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  // Chain links: a URL.
  uri: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  // A fingerprint: a file hash identifies one artefact.
  file_hash: '<path d="M12 11a2 2 0 0 1 2 2c0 2.5-.3 4.4-1 6"/><path d="M8.5 13a3.5 3.5 0 0 1 7 0c0 3-.5 5-1.5 7.5"/><path d="M5 13a7 7 0 0 1 12-5"/><path d="M19 12c0 4-.7 7-2 9.5"/>',
  // A warning triangle: a vulnerability.
  cve: '<path d="M10.3 4 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  // Crosshairs: a technique, i.e. how a target is attacked.
  ttp: '<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  // A person: the actor behind the activity.
  adversary: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
};

/**
 * Which glyph a node shows. IOCs vary by subtype - an IP and a domain are very
 * different things to an analyst - while every other type has one icon.
 */
export function iconKeyFor(
  type: GraphNodeType,
  iocSubtype?: string | null,
): IconKey {
  if (type !== "ioc") return type;
  const key = (iocSubtype ?? "") as IocSubtype;
  // An IOC of an unexpected subtype still gets a glyph rather than a blank node.
  return key in PATHS ? key : "uri";
}

/** The glyph as a data URI, ready for cytoscape's background-image. */
export function iconDataUri(key: IconKey): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ` +
    `stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `${PATHS[key]}</svg>`;
  // Encoded, not base64: shorter, and readable in devtools when a node looks wrong.
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function iconFor(type: GraphNodeType, iocSubtype?: string | null): string {
  return iconDataUri(iconKeyFor(type, iocSubtype));
}
