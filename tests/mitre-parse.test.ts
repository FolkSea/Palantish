import { describe, it, expect } from "vitest";
import { parseTechniques } from "@/lib/mitre/parse";

describe("parseTechniques", () => {
  it("parses a clean JSON array of techniques", () => {
    const raw =
      '[{"code":"T1059.003","name":"Windows Command Shell"},' +
      '{"code":"T1566","name":"Phishing"}]';
    expect(parseTechniques(raw)).toEqual([
      { code: "T1059.003", name: "Windows Command Shell" },
      { code: "T1566", name: "Phishing" },
    ]);
  });

  it("extracts the array from surrounding prose", () => {
    const raw = 'Here are the techniques:\n[{"code":"t1071","name":"C2"}]\nDone.';
    expect(parseTechniques(raw)).toEqual([{ code: "T1071", name: "C2" }]);
  });

  it("drops malformed codes and dedupes", () => {
    const raw =
      '[{"code":"T1059","name":"A"},{"code":"NOPE","name":"B"},' +
      '{"code":"T1059","name":"A dup"},{"name":"no code"}]';
    expect(parseTechniques(raw)).toEqual([{ code: "T1059", name: "A" }]);
  });

  it("falls back to the code when no name is given", () => {
    expect(parseTechniques('[{"code":"T1105"}]')).toEqual([
      { code: "T1105", name: "T1105" },
    ]);
  });

  it("returns an empty array for non-JSON or empty input", () => {
    expect(parseTechniques("no techniques found")).toEqual([]);
    expect(parseTechniques("")).toEqual([]);
  });
});
