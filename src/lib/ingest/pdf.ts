// Recognising a PDF, and the size it has to stay under.
//
// Pure and free of server-only imports so the rules are testable: whether a
// link is a report or a web page decides which import path runs, and that
// decision should not need a network to check.

/**
 * How large a PDF may be.
 *
 * The model reads the document from the request body as base64, the API caps a
 * request at 32MB, and base64 costs a third on top - so 16MB of PDF is a
 * comfortable ceiling rather than an arbitrary one.
 */
export const MAX_PDF_BYTES = 16 * 1024 * 1024;

/** True for a URL that names a PDF, ignoring any query string or fragment. */
export function isPdfUrl(rawUrl: string): boolean {
  try {
    return /\.pdf$/i.test(new URL(rawUrl).pathname);
  } catch {
    return /\.pdf(\?|#|$)/i.test(rawUrl);
  }
}

/** True for a content type that names a PDF. */
export function isPdfContentType(value: string | null | undefined): boolean {
  return /application\/(x-)?pdf/i.test(value ?? "");
}

/**
 * True when the bytes are a PDF, whatever the server called them.
 *
 * Plenty of hosts serve reports as application/octet-stream, and a report an
 * analyst can open in their browser should not fail to import over a header.
 * The signature is the first five bytes: "%PDF-".
 */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

/** The message shown when a PDF is past the size the reader can take. */
export function tooLargeMessage(bytes: number): string {
  return `That PDF is ${Math.round(bytes / 1024 / 1024)}MB, too large to read. Paste the text instead.`;
}
