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
import { buildTopology, generateGraph } from "./model";
import { useGraph } from "./store";

beforeEach(async () => {
  await useGraph.getState().flush();
  const graph = generateGraph(20);
  await persistence.replaceGraph(graph);
  useGraph.setState({
    ...graph,
    topology: buildTopology(graph.edges),
    ready: true,
    busy: false,
    saveState: "saved",
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
});
