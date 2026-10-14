import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { GraphDatabase, loadGraph, replaceGraph, savePatch } from "./database";
import { generateGraph, toStoredEdge, toStoredNode } from "./model";

let database: GraphDatabase | undefined;
afterEach(async () => {
  await database?.delete();
});
describe("IndexedDB persistence", () => {
  it("restores moved nodes, modified edges, media references and the viewport", async () => {
    database = new GraphDatabase(`test-${crypto.randomUUID()}`);
    const graph = generateGraph(100);
    await replaceGraph(graph, database);
    const changed = {
      ...graph.nodes[6],
      position: { x: 123, y: 456 },
      data: { ...graph.nodes[6].data, assetId: "imported-file" },
    };
    const replacement = {
      id: "replacement",
      source: "node-49",
      target: "node-6",
    };
    await savePatch(
      {
        nodes: [toStoredNode(changed)],
        removedEdges: ["edge-6"],
        edges: [toStoredEdge(replacement)],
        viewport: { x: 99, y: 88, zoom: 0.7 },
      },
      database,
    );
    const restored = await loadGraph(database);
    expect(restored?.graph.nodes).toHaveLength(100);
    expect(restored?.graph.nodes[6].position).toEqual({ x: 123, y: 456 });
    expect(restored?.graph.nodes[6].data.assetId).toBe("imported-file");
    expect(restored?.graph.edges.some((e) => e.id === "edge-6")).toBe(false);
    expect(
      restored?.graph.edges.find((e) => e.id === "replacement")?.source,
    ).toBe("node-49");
    expect(restored?.meta.viewport).toEqual({ x: 99, y: 88, zoom: 0.7 });
  });
  it("replaces a data set atomically without leftover nodes or edges", async () => {
    database = new GraphDatabase(`test-${crypto.randomUUID()}`);
    await replaceGraph(generateGraph(1000), database);
    await replaceGraph(generateGraph(100), database);
    const restored = await loadGraph(database);
    expect(restored?.graph.nodes).toHaveLength(100);
    expect(restored?.graph.edges).toHaveLength(99);
    expect(restored?.meta.count).toBe(100);
  });
});
