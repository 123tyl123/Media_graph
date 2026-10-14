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

  it.each(["cycle", "dangling", "invalid node", "version", "viewport", "missing metadata"])(
    "refuses %s on recovery and preserves the stored records", async (corruption) => {
      database = new GraphDatabase(`test-${crypto.randomUUID()}`);
      await replaceGraph(generateGraph(7), database);
      if (corruption === "cycle")
        await database.edges.put({ graphId: "main", id: "cycle", source: "node-3", target: "node-0" });
      if (corruption === "dangling")
        await database.edges.update(["main", "edge-1"], { target: "missing" });
      if (corruption === "invalid node")
        await database.nodes.update(["main", "node-0"], { data: null as never });
      if (corruption === "version")
        await database.graphs.update("main", { schemaVersion: 99 });
      if (corruption === "viewport")
        await database.graphs.update("main", { viewport: { x: 0, y: 0, zoom: 0 } });
      if (corruption === "missing metadata") await database.graphs.delete("main");
      const before = await Promise.all([database.nodes.toArray(), database.edges.toArray(), database.graphs.toArray()]);
      await expect(loadGraph(database)).rejects.toThrow();
      expect(await Promise.all([database.nodes.toArray(), database.edges.toArray(), database.graphs.toArray()])).toEqual(before);
    },
  );

  it("returns null only for a workspace without graph records", async () => {
    database = new GraphDatabase(`test-${crypto.randomUUID()}`);
    expect(await loadGraph(database)).toBeNull();
  });
});
