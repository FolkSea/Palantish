import { describe, it, expect } from "vitest";
import {
  MAX_PDF_BYTES,
  isPdfContentType,
  isPdfUrl,
  looksLikePdf,
  tooLargeMessage,
} from "@/lib/ingest/pdf";

const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

describe("isPdfUrl", () => {
  it("accepts a link to a PDF", () => {
    expect(isPdfUrl("https://vendor.example/reports/apt-2026.pdf")).toBe(true);
    expect(isPdfUrl("https://vendor.example/REPORT.PDF")).toBe(true);
  });

  // A tracking query is on most links an analyst pastes.
  it("ignores the query string and fragment", () => {
    expect(isPdfUrl("https://vendor.example/r.pdf?utm_source=x")).toBe(true);
    expect(isPdfUrl("https://vendor.example/r.pdf#page=4")).toBe(true);
  });

  it("rejects a page that only mentions pdf", () => {
    expect(isPdfUrl("https://vendor.example/pdf-reports")).toBe(false);
    expect(isPdfUrl("https://vendor.example/post?file=x.pdf")).toBe(false);
    expect(isPdfUrl("https://vendor.example/blog/how-to-read-a-pdf")).toBe(false);
  });

  it("does not throw on something that is not a URL", () => {
    expect(isPdfUrl("not a url")).toBe(false);
    expect(isPdfUrl("also-not-a-url.pdf")).toBe(true);
  });
});

describe("isPdfContentType", () => {
  it("accepts the PDF content types, with parameters", () => {
    expect(isPdfContentType("application/pdf")).toBe(true);
    expect(isPdfContentType("application/pdf; charset=binary")).toBe(true);
    expect(isPdfContentType("application/x-pdf")).toBe(true);
  });

  it("rejects everything else, including nothing at all", () => {
    for (const value of ["text/html", "application/octet-stream", "", null, undefined])
      expect(isPdfContentType(value)).toBe(false);
  });
});

describe("looksLikePdf", () => {
  // The case the byte check exists for: a report served as a generic download.
  it("recognises a PDF by its signature", () => {
    expect(looksLikePdf(PDF_HEADER)).toBe(true);
  });

  it("rejects other content and short bodies", () => {
    expect(looksLikePdf(new TextEncoder().encode("<!doctype html>"))).toBe(false);
    expect(looksLikePdf(new Uint8Array([0x25, 0x50, 0x44]))).toBe(false);
    expect(looksLikePdf(new Uint8Array())).toBe(false);
  });
});

describe("size limit", () => {
  // The API caps a request at 32MB and base64 adds a third, so the document
  // itself has to leave room for the encoding.
  it("leaves room for base64 expansion under the 32MB request cap", () => {
    expect(MAX_PDF_BYTES * (4 / 3)).toBeLessThan(32 * 1024 * 1024);
  });

  it("says how big the file was, and what to do instead", () => {
    const message = tooLargeMessage(24 * 1024 * 1024);
    expect(message).toContain("24MB");
    expect(message).toContain("Paste the text");
  });
});
