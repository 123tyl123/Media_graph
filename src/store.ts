import { create } from "zustand";
import { applyNodeChanges, applyEdgeChanges } from "@xyflow/react";
import type {
  NodeChange,
  EdgeChange,
  Viewport,
  Connection,
} from "@xyflow/react";
import {
  buildTopology,
  connectionError,
  generateGraph,
  toStoredNode,
  toStoredEdge,
} from "./model";
import type {
  MediaNode,
  GraphEdge,
  Topology,
  StoredNode,
  StoredEdge,
  Graph,
} from "./model";
import { db, loadGraph, replaceGraph, savePatch } from "./database";

type SaveState = "loading" | "saved" | "pending" | "saving" | "error";
interface GraphState extends Graph {
  topology: Topology;
  ready: boolean;
  busy: boolean;
  selectedId: string | null;
  selectedEdge: string | null;
  previewId: string | null;
  overview: boolean;
  compact: boolean;
  culling: boolean;
  viewport: Viewport;
  saveState: SaveState;
  notice: string;
  loadMs: number;
  initialize: () => Promise<void>;
  regenerate: (count: number) => Promise<void>;
  onNodesChange: (changes: NodeChange<MediaNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<GraphEdge>[]) => void;
  connect: (connection: Connection) => void;
  disconnect: (id: string) => void;
  savePosition: (node: MediaNode) => void;
  saveViewport: (viewport: Viewport) => void;
  replaceMedia: (
    id: string,
    assetId: string,
    kind: "image" | "video",
    title: string,
  ) => void;
  flush: () => Promise<void>;
}
let initializePromise: Promise<void> | undefined;
let saveTail: Promise<void> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | undefined;
const dirtyNodes = new Map<string, StoredNode>();
const dirtyEdges = new Map<string, StoredEdge>();
const removedEdges = new Set<string>();
let dirtyViewport: Viewport | undefined;

function markDirty() {
  useGraph.setState({ saveState: "pending" });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void useGraph.getState().flush(), 450);
}

export const useGraph = create<GraphState>((set, get) => ({
  nodes: [],
  edges: [],
  topology: buildTopology([]),
  ready: false,
  busy: false,
  selectedId: "node-0",
  selectedEdge: null,
  previewId: null,
  overview: false,
  compact: false,
  culling: true,
  viewport: { x: 350, y: 64, zoom: 0.82 },
  saveState: "loading",
  notice: "",
  loadMs: 0,
  initialize: () => {
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      const start = performance.now();
      try {
        const saved = await loadGraph();
        const graph = saved?.graph ?? generateGraph(10_000);
        if (!saved) await replaceGraph(graph);
        const viewport = saved?.meta.viewport ?? get().viewport;
        set({
          ...graph,
          topology: buildTopology(graph.edges),
          viewport,
          ready: true,
          saveState: "saved",
          loadMs: performance.now() - start,
        });
      } catch (error) {
        // Preserve failed stored data; offer a usable in-memory graph and explicit recovery.
        const graph = generateGraph(10_000);
        set({
          ...graph,
          topology: buildTopology(graph.edges),
          ready: true,
          saveState: "error",
          notice: `本地存储加载失败：${String(error)}。可导出数据，或重新生成以恢复保存。`,
          loadMs: performance.now() - start,
        });
      }
    })();
    return initializePromise;
  },
  regenerate: async (count) => {
    if (get().busy) return;
    set({ busy: true, notice: "" });
    try {
      await get().flush();
      const start = performance.now();
      const graph = generateGraph(count);
      await replaceGraph(graph);
      dirtyNodes.clear();
      dirtyEdges.clear();
      removedEdges.clear();
      dirtyViewport = undefined;
      set({
        ...graph,
        topology: buildTopology(graph.edges),
        selectedId: "node-0",
        selectedEdge: null,
        previewId: null,
        overview: false,
        compact: false,
        saveState: "saved",
        loadMs: performance.now() - start,
      });
    } catch (error) {
      set({ saveState: "error", notice: `生成失败：${String(error)}` });
    } finally {
      set({ busy: false });
    }
  },
  onNodesChange: (changes) => {
    // Node removal is intentionally disabled: a node owns subtree topology.
    const permitted = changes.filter((change) => change.type !== "remove");
    set((state) => ({ nodes: applyNodeChanges(permitted, state.nodes) }));
  },
  onEdgesChange: (changes) => {
    const deleted = changes.filter((c) => c.type === "remove").map((c) => c.id);
    const edges = applyEdgeChanges(changes, get().edges);
    set({
      edges,
      ...(deleted.length
        ? { topology: buildTopology(edges), selectedEdge: null }
        : {}),
    });
    for (const id of deleted) {
      dirtyEdges.delete(id);
      removedEdges.add(id);
    }
    if (deleted.length) markDirty();
  },
  connect: (connection) => {
    const state = get();
    if (state.busy) return;
    if (
      !state.nodes.some((n) => n.id === connection.source) ||
      !state.nodes.some((n) => n.id === connection.target)
    ) {
      set({ notice: "未找到目标节点，请检查 ID" });
      return;
    }
    const error = connectionError(
      connection.source,
      connection.target,
      state.topology,
    );
    if (error) {
      set({ notice: error });
      return;
    }
    const edge: GraphEdge = {
      id: `edge-${crypto.randomUUID()}`,
      ...connection,
    };
    const edges = [...state.edges, edge];
    dirtyEdges.set(edge.id, toStoredEdge(edge));
    set({ edges, topology: buildTopology(edges), notice: "连线已建立" });
    markDirty();
  },
  disconnect: (id) => get().onEdgesChange([{ id, type: "remove" }]),
  savePosition: (node) => {
    dirtyNodes.set(node.id, toStoredNode(node));
    markDirty();
  },
  saveViewport: (viewport) => {
    set({ viewport });
    dirtyViewport = viewport;
    markDirty();
  },
  replaceMedia: (id, assetId, kind, title) => {
    const nodes = get().nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, assetId, kind, title } } : n,
    );
    const changed = nodes.find((n) => n.id === id);
    if (!changed) return;
    dirtyNodes.set(id, toStoredNode(changed));
    set({ nodes, notice: "素材已替换并保存在本地" });
    markDirty();
  },
  flush: async () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    const run = async () => {
      // Take the snapshot when this write starts. Newer queued values supersede older ones.
      const patch = {
        nodes: [...dirtyNodes.values()],
        edges: [...dirtyEdges.values()],
        removedEdges: [...removedEdges],
        viewport: dirtyViewport,
      };
      if (
        !patch.nodes.length &&
        !patch.edges.length &&
        !patch.removedEdges.length &&
        !patch.viewport
      )
        return;
      set({ saveState: "saving" });
      try {
        await savePatch(patch);
        for (const node of patch.nodes)
          if (dirtyNodes.get(node.id) === node) dirtyNodes.delete(node.id);
        for (const edge of patch.edges)
          if (dirtyEdges.get(edge.id) === edge) dirtyEdges.delete(edge.id);
        for (const id of patch.removedEdges) removedEdges.delete(id);
        if (dirtyViewport === patch.viewport) dirtyViewport = undefined;
        set({
          saveState:
            dirtyNodes.size ||
            dirtyEdges.size ||
            removedEdges.size ||
            dirtyViewport
              ? "pending"
              : "saved",
        });
      } catch (error) {
        // Leave dirty values in place. A retry must never restore an obsolete snapshot.
        set({
          saveState: "error",
          notice: `保存失败：${String(error)}。请导出数据备份，并点击保存重试。`,
        });
      }
    };
    saveTail = saveTail.then(run, run);
    await saveTail;
  },
}));

export async function exportGraph() {
  const state = useGraph.getState();
  const assets = await db.assets.toArray().catch(() => []);
  // JSON contains graph metadata; imported media remains in IndexedDB.
  const data = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    nodes: state.nodes.map(toStoredNode),
    edges: state.edges.map(toStoredEdge),
    viewport: state.viewport,
    importedAssets: assets.map(
      ({ blob: _blob, posterBlob: _poster, ...asset }) => asset,
    ),
    mediaNote:
      "导入的二进制媒体保存在当前浏览器 IndexedDB，此 JSON 只导出图结构和素材元数据。",
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `frame-graph-${state.nodes.length}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
