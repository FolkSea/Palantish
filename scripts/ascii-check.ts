/**
 * CI guard: fails if any non-ASCII character appears in source under src/.
 * The dashboard must render plain-text headings only (no emoji, flags, or
 * decorative glyphs), which otherwise cause mojibake. Run via `pnpm ascii-check`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOTS = ["src"];
const EXTS = new Set([".ts", ".tsx", ".css"]);
// Printable ASCII plus tab, newline, carriage return.
const ALLOWED = /^[\t\n\r\x20-\x7E]*$/;

type Violation = { file: string; line: number; col: number; char: string };

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full, out);
    } else if (EXTS.has(extname(entry))) {
      out.push(full);
    }
  }
}

function scan(file: string): Violation[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const violations: Violation[] = [];
  lines.forEach((line, i) => {
    if (ALLOWED.test(line)) return;
    for (let c = 0; c < line.length; c++) {
      const code = line.codePointAt(c)!;
      if (code < 0x20 && code !== 0x09) continue; // ignore other control chars
      if (code > 0x7e) {
        violations.push({ file, line: i + 1, col: c + 1, char: line[c] });
      }
    }
  });
  return violations;
}

const files: string[] = [];
for (const root of ROOTS) walk(root, files);

const violations = files.flatMap(scan);

if (violations.length > 0) {
  console.error("Non-ASCII characters found (headings/UI must be ASCII-only):");
  for (const v of violations) {
    console.error(
      `  ${v.file}:${v.line}:${v.col}  U+${v.char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`,
    );
  }
  process.exit(1);
}

console.log(`ASCII check passed (${files.length} files scanned).`);
