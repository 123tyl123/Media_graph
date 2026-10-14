import "fake-indexeddb/auto";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as persistence from "./database";
import { buildNodeIndex, buildTopology, generateGraph } from "./model";
import { selectNode, useGraph } from "./store";

beforeEach(async () => {
  await useGraph.getState().flush();
  const graph = generateGraph(20);
  await persistence.replaceGraph(graph);
  useGraph.setState({
    ...graph,
    nodeIndex: buildNodeIndex(graph.nodes),
    topology: buildTopology(graph.edges),
    ready: true,
    busy: false,
    saveState: "saved",
    persistenceBlocked: false,
    notice: "",
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await useGraph.getState().flush();
});
afterAll(async () => {
  await persistence.db.delete();
});

describe("incremental save queue", () => {
  it("keeps ID lookup current and untouched node references stable during a move", () => {
    const before = useGraph.getState();
    const index = before.nodeIndex;
    const untouched = selectNode(before, "node-4");
    useGraph.getState().onNodesChange([{ type: "position", id: "node-3", position: { x: 12, y: 34 } }]);
    const after = useGraph.getState();
    expect(after.nodeIndex).toBe(index);
    expect(selectNode(after, "node-3")?.position).toEqual({ x: 12, y: 34 });
    expect(selectNode(after, "node-4")).toBe(untouched);
    expect(selectNode(after, "missing")).toBeUndefined();
  });

  it("updates ID lookup when node membership changes", () => {
    const node = { ...generateGraph(1).nodes[0], id: "extra" };
    useGraph.getState().onNodesChange([{ type: "add", item: node, index: 0 }]);
    expect(selectNode(useGraph.getState(), "extra")).toEqual(node);
    expect(selectNode(useGraph.getState(), "node-3")?.id).toBe("node-3");
  });
  it("coalesces rapid node moves and keeps the final position", async () => {
    for (let x = 0; x < 30; x++) {
      useGraph
        .getState()
        .onNodesChange([
          { type: "position", id: "node-3", position: { x, y: 77 } },
        ]);
      useGraph.getState().savePosition(useGraph.getState().nodes[3]);
    }
    await useGraph.getState().flush();
    const restored = await persistence.loadGraph();
    expect(restored?.graph.nodes[3].position).toEqual({ x: 29, y: 77 });
    expect(restored?.graph.nodes[4].position).toEqual(
      generateGraph(20).nodes[4].position,
    );
    expect(useGraph.getState().saveState).toBe("saved");
  });
  it("serializes concurrent viewport saves so the latest viewport wins", async () => {
    useGraph.getState().saveViewport({ x: 1, y: 2, zoom: 0.8 });
    const first = useGraph.getState().flush();
    useGraph.getState().saveViewport({ x: 10, y: 20, zoom: 1.1 });
    const second = useGraph.getState().flush();
    await Promise.all([first, second]);
    expect((await persistence.loadGraph())?.meta.viewport).toEqual({
      x: 10,
      y: 20,
      zoom: 1.1,
    });
  });
  it("keeps edits made during a successful write pending until a second transaction", async () => {
    let finishFirst!: () => Promise<void>;
    const originalSave = persistence.savePatch;
    const saveSpy = vi.spyOn(persistence, "savePatch").mockImplementationOnce(
      (patch) =>
        new Promise<void>((resolve, reject) => {
          finishFirst = async () => {
            try {
              await originalSave(patch);
              resolve();
            } catch (error) {
              reject(error);
            }
          };
        }),
    );
    const oldNode = { ...useGraph.getState().nodes[3], position: { x: 100, y: 50 } };
    useGraph.getState().savePosition(oldNode);
    useGraph.getState().saveViewport({ x: 1, y: 2, zoom: 0.8 });
    const first = useGraph.getState().flush();
    await vi.waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));

    useGraph.getState().savePosition({ ...oldNode, position: { x: 900, y: 600 } });
    useGraph.getState().saveViewport({ x: 10, y: 20, zoom: 1.1 });
    await finishFirst();
    await first;
    expect(useGraph.getState().saveState).toBe("pending");
    expect((await persistence.loadGraph())?.graph.nodes[3].position.x).toBe(100);

    await useGraph.getState().flush();
    const restored = await persistence.loadGraph();
    expect(restored?.graph.nodes[3].position).toEqual({ x: 900, y: 600 });
    expect(restored?.meta.viewport).toEqual({ x: 10, y: 20, zoom: 1.1 });
    expect(saveSpy).toHaveBeenCalledTimes(2);
    expect(useGraph.getState().saveState).toBe("saved");
  });

  it("does not announce a media node reference as saved before its transaction", async () => {
    useGraph.getState().replaceMedia("node-3", "sample-0", "image", "replacement");
    expect(useGraph.getState().saveState).toBe("pending");
    expect(useGraph.getState().notice).not.toContain("保存在本地");
    await useGraph.getState().flush();
    expect((await persistence.loadGraph())?.graph.nodes[3].data.title).toBe("replacement");
    expect(useGraph.getState().saveState).toBe("saved");
  });
  it("retries a failed in-flight write without overwriting a newer node position", async () => {
    let rejectFirst: (reason: Error) => void = () => {};
    const saveSpy = vi.spyOn(persistence, "savePatch").mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        }),
    );
    const firstNode = {
      ...useGraph.getState().nodes[3],
      position: { x: 100, y: 50 },
    };
    useGraph.getState().savePosition(firstNode);
    const first = useGraph.getState().flush();
    await vi.waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    const latestNode = { ...firstNode, position: { x: 900, y: 600 } };
    useGraph.getState().savePosition(latestNode);
    const second = useGraph.getState().flush();
    rejectFirst(new Error("simulated quota failure"));
    await Promise.all([first, second]);
    expect((await persistence.loadGraph())?.graph.nodes[3].position).toEqual({
      x: 900,
      y: 600,
    });
    expect(useGraph.getState().saveState).toBe("saved");
  });
  it("persists detach/reconnect operations and refuses invalid edges", async () => {
    useGraph.getState().disconnect("edge-3");
    useGraph
      .getState()
      .connect({
        source: "node-19",
        target: "node-3",
        sourceHandle: "out",
        targetHandle: "in",
      });
    expect(useGraph.getState().topology.parent.get("node-3")).toBe("node-19");
    const before = useGraph.getState().edges.length;
    useGraph
      .getState()
      .connect({
        source: "node-15",
        target: "node-0",
        sourceHandle: "out",
        targetHandle: "in",
      });
    expect(useGraph.getState().edges.length).toBe(before);
    expect(useGraph.getState().notice).toContain("环");
    await useGraph.getState().flush();
    const restored = await persistence.loadGraph();
    expect(restored?.graph.edges.some((e) => e.id === "edge-3")).toBe(false);
    expect(
      restored?.graph.edges.some(
        (e) => e.source === "node-19" && e.target === "node-3",
      ),
    ).toBe(true);
  });

  it("isolates the fallback graph after recovery fails until explicit regeneration", async () => {
    await persistence.db.edges.put({ graphId: "main", id: "cycle", source: "node-3", target: "node-0" });
    const before = await Promise.all([persistence.db.nodes.toArray(), persistence.db.edges.toArray()]);
    await useGraph.getState().initialize();
    expect(useGraph.getState().persistenceBlocked).toBe(true);
    expect(useGraph.getState().saveState).toBe("error");
    const saveSpy = vi.spyOn(persistence, "savePatch");
    useGraph.getState().replaceMedia("node-3", "sample-0", "image", "temporary edit");
    useGraph.getState().saveViewport({ x: 0, y: 0, zoom: 1 });
    await useGraph.getState().flush();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(await Promise.all([persistence.db.nodes.toArray(), persistence.db.edges.toArray()])).toEqual(before);

    await useGraph.getState().regenerate(100);
    expect(useGraph.getState().persistenceBlocked).toBe(false);
    expect((await persistence.loadGraph())?.graph.nodes).toHaveLength(100);
    useGraph.getState().saveViewport({ x: 10, y: 20, zoom: 1 });
    await useGraph.getState().flush();
    expect((await persistence.loadGraph())?.meta.viewport.x).toBe(10);
  });
});
