import { describe, it, expect } from "vitest";
import {
  itemNode,
  iocNode,
  cveNode,
  adversaryNodeFor,
  edge,
  parseNodeId,
  mergeGraph,
  nodeTypeForIoc,
} from "@/lib/graph/build";

describe("nodeTypeForIoc", () => {
  it("maps ioc_type to a graph node type", () => {
    expect(nodeTypeForIoc("mitre")).toBe("ttp");
    expect(nodeTypeForIoc("cve")).toBe("cve");
    for (const t of ["ip", "domain", "uri", "file_hash"])
      expect(nodeTypeForIoc(t)).toBe("ioc");
  });
});

describe("node builders", () => {
  it("builds an item node with modal fields and a type-prefixed id", () => {
    const n = itemNode({
      id: "abc",
      title: "A report",
      raw_hash: "h1",
      url: "https://x",
      description: "d",
      source_name: "src",
      published_at: "2026-07-20",
    });
    expect(n).toMatchObject({
      id: "item:abc",
      type: "item",
      label: "A report",
      rawHash: "h1",
      url: "https://x",
    });
  });

  it("classifies iocs and upper-cases CVEs so both CVE sources collapse", () => {
    expect(iocNode("1.2.3.4", "ip")).toMatchObject({ id: "ioc:1.2.3.4", type: "ioc", iocSubtype: "ip" });
    expect(cveNode("cve-2026-16232").id).toBe("cve:CVE-2026-16232");
    expect(iocNode("CVE-2026-16232", "cve").id).toBe("cve:CVE-2026-16232");
  });

  it("labels a TTP with its ATT&CK technique name", () => {
    const n = iocNode("T1003", "mitre");
    expect(n.type).toBe("ttp");
    expect(n.id).toBe("ttp:T1003");
    expect(n.label).toContain("T1003");
    expect(n.label).toContain("Credential Dumping");
  });

  it("only makes adversary nodes for specific actors, not UNID placeholders", () => {
    expect(adversaryNodeFor("VANGUARD PANDA", "china")).toMatchObject({
      id: "adv:VANGUARD PANDA",
      type: "adversary",
      nexus: "china",
    });
    expect(adversaryNodeFor("UNID PANDA")).toBeNull();
    expect(adversaryNodeFor(null)).toBeNull();
  });
});

describe("edges + ids", () => {
  it("dedupes an edge regardless of endpoint order", () => {
    expect(edge("a", "b").id).toBe(edge("b", "a").id);
  });

  it("parses a node id on the first colon (values may contain colons)", () => {
    expect(parseNodeId("ioc:https://a.b/c")).toEqual({ type: "ioc", key: "https://a.b/c" });
    expect(parseNodeId("item:abc")).toEqual({ type: "item", key: "abc" });
  });
});

describe("mergeGraph", () => {
  it("dedupes nodes and edges by id", () => {
    const a = { nodes: [{ id: "n1", type: "item" as const, label: "x" }], edges: [edge("n1", "n2")] };
    const b = {
      nodes: [
        { id: "n1", type: "item" as const, label: "x" },
        { id: "n2", type: "ioc" as const, label: "y" },
      ],
      edges: [edge("n2", "n1")],
    };
    const m = mergeGraph(a, b);
    expect(m.nodes.map((n) => n.id).sort()).toEqual(["n1", "n2"]);
    expect(m.edges).toHaveLength(1);
  });
});
