import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ALLOWED = /^[\t\n\r\x20-\x7E]*$/;
const EXTS = new Set([".ts", ".tsx", ".css"]);

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full, out);
    } else if (EXTS.has(extname(entry))) {
      out.push(full);
    }
  }
}

describe("ASCII-only source (headings + UI)", () => {
  it("contains no non-ASCII characters under src/", () => {
    const files: string[] = [];
    walk("src", files);
    const offenders = files.filter((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .some((line) => !ALLOWED.test(line)),
    );
    expect(offenders).toEqual([]);
  });
});
