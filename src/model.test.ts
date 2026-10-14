import { describe, expect, it } from "vitest";
import {
  buildOverview,
  buildTopology,
  connectionError,
  generateGraph,
  toStoredNode,
  validateGraph,
} from "./model";

describe("binary media graph", () => {
  it.each([1, 100, 1000, 10_000])(
    "generates a connected binary tree with %i nodes",
    (count) => {
      const graph = generateGraph(count);
      const topology = buildTopology(graph.edges);
      expect(graph.nodes).toHaveLength(count);
      expect(graph.edges).toHaveLength(count - 1);
      expect(topology.parent.has("node-0")).toBe(false);
      expect(topology.parent.size).toBe(count - 1);
      expect(
        [...topology.children.values()].every(
          (children) => children.length <= 2,
        ),
      ).toBe(true);
      expect(
        new Set(graph.nodes.map((n) => `${n.position.x},${n.position.y}`)).size,
      ).toBe(count);
      expect(
        graph.nodes.every(
          (n) => Number.isFinite(n.position.x) && Number.isFinite(n.position.y),
        ),
      ).toBe(true);
    },
  );
  it("has 14 levels and 1809 nodes in the incomplete last level", () => {
    const graph = generateGraph(10_000);
    expect(Math.max(...graph.nodes.map((n) => n.data.depth))).toBe(13);
    expect(graph.nodes.filter((n) => n.data.depth === 13)).toHaveLength(1809);
  });
  it("rejects self, duplicate, multiple-parent, third-child, and cyclic connections", () => {
    const tree = generateGraph(7);
    const full = buildTopology(tree.edges);
    expect(connectionError("node-0", "node-0", full)).toContain("自身");
    expect(connectionError("node-0", "node-1", full)).toContain("已存在");
    expect(connectionError("node-3", "node-2", full)).toContain("已有父节点");
    expect(connectionError("node-3", "node-0", full)).toContain("环");
    expect(connectionError("node-0", "new-root", full)).toContain("两个");
    const detached = buildTopology(
      tree.edges.filter((e) => e.target !== "node-6"),
    );
    expect(connectionError("node-3", "node-6", detached)).toBeNull();
  });
  it("accounts for every real node in the overview without changing the graph", () => {
    const graph = generateGraph(10_000);
    const original = JSON.stringify(graph);
    const overview = buildOverview(graph, buildTopology(graph.edges));
    expect(overview.nodes.length).toBeLessThanOrEqual(255);
    expect(overview.nodes.reduce((sum, n) => sum + n.data.count, 0)).toBe(
      10_000,
    );
    expect(JSON.stringify(graph)).toBe(original);
    const ids = new Set(overview.nodes.map((n) => n.id));
    expect(
      overview.edges.every((e) => ids.has(e.source) && ids.has(e.target)),
    ).toBe(true);
  });
  it("handles a detached subtree and retains persisted node metadata", () => {
    const graph = generateGraph(100);
    graph.edges = graph.edges.filter((e) => e.target !== "node-5");
    const overview = buildOverview(graph, buildTopology(graph.edges));
    expect(overview.nodes.reduce((sum, n) => sum + n.data.count, 0)).toBe(100);
    expect(overview.nodes.some((n) => n.id === "node-5")).toBe(true);
    const stored = toStoredNode({
      ...graph.nodes[5],
      selected: true,
      dragging: true,
    });
    expect(stored).not.toHaveProperty("selected");
    expect(stored).not.toHaveProperty("dragging");
  });
});

describe("graph recovery validation", () => {
  it("accepts a disconnected forest without changing IDs or initial metadata", () => {
    const graph = generateGraph(100);
    graph.edges = graph.edges.filter((edge) => edge.target !== "node-5");
    const before = JSON.stringify(graph);
    expect(validateGraph(graph)).toEqual({ valid: true });
    expect(JSON.stringify(graph)).toBe(before);
  });

  it.each([
    ["duplicate node IDs", (graph: ReturnType<typeof generateGraph>) => { graph.nodes[1].id = graph.nodes[0].id; }, "重复"],
    ["duplicate edge IDs", (graph: ReturnType<typeof generateGraph>) => { graph.edges[1].id = graph.edges[0].id; }, "重复"],
    ["dangling edges", (graph: ReturnType<typeof generateGraph>) => { graph.edges[0].target = "missing"; }, "不存在"],
    ["self connections", (graph: ReturnType<typeof generateGraph>) => { graph.edges[0].target = graph.edges[0].source; }, "自身"],
    ["duplicate connections", (graph: ReturnType<typeof generateGraph>) => { graph.edges.push({ ...graph.edges[0], id: "extra" }); }, "重复"],
    ["multiple parents", (graph: ReturnType<typeof generateGraph>) => { graph.edges.push({ id: "extra", source: "node-2", target: "node-3" }); }, "父节点"],
    ["third children", (graph: ReturnType<typeof generateGraph>) => { graph.edges = graph.edges.filter((edge) => edge.target !== "node-3"); graph.edges.push({ id: "extra", source: "node-0", target: "node-3" }); }, "两个"],
    ["rootless cycles", (graph: ReturnType<typeof generateGraph>) => { graph.edges = [{ id: "a", source: "node-0", target: "node-1" }, { id: "b", source: "node-1", target: "node-0" }]; }, "环"],
    ["non-finite positions", (graph: ReturnType<typeof generateGraph>) => { graph.nodes[0].position.x = Infinity; }, "坐标"],
  ])("rejects %s", (_name, corrupt, message) => {
    const graph = generateGraph(7);
    corrupt(graph);
    expect(validateGraph(graph)).toEqual({ valid: false, error: expect.stringContaining(message) });
  });

  it.each([null, {}, { nodes: [], edges: null }, { nodes: [null], edges: [] },
    { nodes: [{ id: "node-0", position: { x: 0, y: 0 }, data: {} }], edges: [] },
  ])("rejects malformed runtime input: %j", (value) => {
    expect(validateGraph(value).valid).toBe(false);
  });

  it("handles a 10,000-node chain iteratively", () => {
    const graph = generateGraph(10000);
    graph.edges = graph.edges.map((edge, index) => ({ ...edge, source: `node-${index}` }));
    expect(validateGraph(graph)).toEqual({ valid: true });
    graph.edges.push({ id: "cycle", source: "node-9999", target: "node-0" });
    expect(validateGraph(graph)).toEqual({ valid: false, error: expect.stringContaining("环") });
  });
});
