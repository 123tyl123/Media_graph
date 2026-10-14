import Dexie, { type Table } from "dexie";
import {
  DEFAULT_VIEWPORT,
  GRAPH_SCHEMA_VERSION,
  fromStoredNode,
  toStoredEdge,
  toStoredNode,
  validateGraph,
} from "./model";
import type { Asset, Graph, GraphMeta, StoredNode, StoredEdge } from "./model";
import type { Viewport } from "@xyflow/react";

export class GraphDatabase extends Dexie {
  graphs!: Table<GraphMeta, string>;
  nodes!: Table<StoredNode, [string, string]>;
  edges!: Table<StoredEdge, [string, string]>;
  assets!: Table<Asset, string>;
  constructor(name = "frame-media-graph") {
    super(name);
    this.version(1).stores({
      graphs: "id",
      nodes: "[graphId+id],graphId",
      edges: "[graphId+id],graphId",
      assets: "id",
    });
  }
}
// Explicit workspace URLs isolate test runs from the user's default local graph.
const workspace =
  typeof window === "undefined"
    ? null
    : new URLSearchParams(window.location.search).get("workspace");
const safeWorkspace =
  workspace && /^[a-zA-Z0-9_-]{1,48}$/.test(workspace) ? workspace : null;
export const db = new GraphDatabase(
  safeWorkspace ? `frame-media-graph-${safeWorkspace}` : undefined,
);

export async function loadGraph(
  database = db,
): Promise<{ graph: Graph; meta: GraphMeta } | null> {
  // Read metadata and graph records from one consistent IndexedDB snapshot.
  return database.transaction("r", [database.graphs, database.nodes, database.edges], async () => {
    const [meta, nodes, storedEdges] = await Promise.all([
      database.graphs.get("main"),
      database.nodes.where("graphId").equals("main").toArray(),
      database.edges.where("graphId").equals("main").toArray(),
    ]);
    if (!meta) {
      if (nodes.length || storedEdges.length) throw new Error("本地图元数据缺失，原记录已保留");
      return null;
    }
    if (meta.schemaVersion !== GRAPH_SCHEMA_VERSION)
      throw new Error(`不支持的图数据版本：${meta.schemaVersion}，原记录已保留`);
    if (!Number.isInteger(meta.count) || meta.count < 0 || nodes.length !== meta.count)
      throw new Error("本地图数据不完整，原记录已保留");
    const viewport = meta.viewport;
    if (!viewport || !Number.isFinite(viewport.x) || !Number.isFinite(viewport.y) ||
      !Number.isFinite(viewport.zoom) || viewport.zoom <= 0 || !Number.isFinite(meta.savedAt))
      throw new Error("本地图视口或保存时间无效，原记录已保留");
    const graph = {
      nodes: nodes.map(fromStoredNode),
      edges: storedEdges.map(({ graphId: _graphId, ...edge }) => edge),
    };
    const validation = validateGraph(graph);
    if (!validation.valid) throw new Error(`本地图数据无效：${validation.error}，原记录已保留`);
    graph.nodes.sort((a, b) => a.data.order - b.data.order);
    return { graph, meta };
  });
}

export async function replaceGraph(graph: Graph, database = db) {
  await database.transaction(
    "rw",
    [database.nodes, database.edges, database.graphs],
    async () => {
      // Delete by primary-key range so IndexedDB can avoid one cursor delete per row.
      await database.nodes
        .where("[graphId+id]")
        .between(["main", Dexie.minKey], ["main", Dexie.maxKey])
        .delete();
      await database.edges
        .where("[graphId+id]")
        .between(["main", Dexie.minKey], ["main", Dexie.maxKey])
        .delete();
      await database.nodes.bulkPut(graph.nodes.map(toStoredNode));
      await database.edges.bulkPut(graph.edges.map(toStoredEdge));
      await database.graphs.put({
        id: "main",
        count: graph.nodes.length,
        viewport: DEFAULT_VIEWPORT,
        savedAt: Date.now(),
        schemaVersion: GRAPH_SCHEMA_VERSION,
      });
    },
  );
}

export interface Patch {
  nodes: StoredNode[];
  edges: StoredEdge[];
  removedEdges: string[];
  viewport?: Viewport;
}
export async function savePatch(patch: Patch, database = db) {
  await database.transaction(
    "rw",
    [database.nodes, database.edges, database.graphs],
    async () => {
      if (patch.nodes.length) await database.nodes.bulkPut(patch.nodes);
      if (patch.removedEdges.length)
        await database.edges.bulkDelete(
          patch.removedEdges.map((id) => ["main", id]),
        );
      if (patch.edges.length) await database.edges.bulkPut(patch.edges);
      await database.graphs.update("main", {
        ...(patch.viewport ? { viewport: patch.viewport } : {}),
        savedAt: Date.now(),
      });
    },
  );
}

export function resolveMediaPath(path: string) {
  if (typeof window === "undefined") return path;
  return (
    (window as Window & { frameAssetUrls?: Record<string, string> })
      .frameAssetUrls?.[path] ?? path
  );
}
export const sampleAssets: Asset[] = Array.from({ length: 6 }, (_, i) => ({
  id: `sample-${i}`,
  kind: i % 2 ? "video" : "image",
  name: `示例素材 ${i + 1}`,
  url: resolveMediaPath(i % 2 ? "/media/flower.mp4" : `/media/scene-${i}.svg`),
  posterUrl: resolveMediaPath(`/media/scene-${i}.svg`),
}));

// A bounded thumbnail cache keeps imported Blob URLs independent of graph records.
const thumbnails = new Map<
  string,
  { url: string; users: number; blobUrl: boolean }
>();
export async function acquireThumbnail(assetId: string): Promise<string> {
  let cached = thumbnails.get(assetId);
  if (cached) {
    cached.users++;
    return cached.url;
  }
  const asset =
    sampleAssets.find((a) => a.id === assetId) ??
    (await db.assets.get(assetId));
  if (!asset) throw new Error("素材不存在");
  cached = thumbnails.get(assetId);
  if (cached) {
    cached.users++;
    return cached.url;
  }
  const blob =
    asset.posterBlob ?? (asset.kind === "image" ? asset.blob : undefined);
  const url = blob
    ? URL.createObjectURL(blob)
    : (asset.posterUrl ?? asset.url ?? resolveMediaPath("/media/scene-0.svg"));
  thumbnails.set(assetId, { url, users: 1, blobUrl: Boolean(blob) });
  trimThumbnailCache();
  return url;
}
export function releaseThumbnail(assetId: string) {
  const cached = thumbnails.get(assetId);
  if (cached) cached.users = Math.max(0, cached.users - 1);
  trimThumbnailCache();
}
function trimThumbnailCache() {
  if (thumbnails.size <= 100) return;
  for (const [key, value] of thumbnails) {
    if (!value.users) {
      if (value.blobUrl) URL.revokeObjectURL(value.url);
      thumbnails.delete(key);
    }
    if (thumbnails.size <= 100) break;
  }
}
export async function getAsset(id: string) {
  return sampleAssets.find((a) => a.id === id) ?? db.assets.get(id);
}

export async function importAsset(file: File): Promise<Asset> {
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/"))
    throw new Error("请选择图片或视频文件");
  const kind = file.type.startsWith("image/") ? "image" : "video";
  let posterBlob: Blob | undefined;
  if (kind === "image") {
    let source: ImageBitmap | HTMLImageElement | undefined;
    let temporaryUrl: string | undefined;
    try {
      try {
        source = await createImageBitmap(file);
      } catch {
        // Some Chromium versions cannot decode SVG Blobs with createImageBitmap.
        temporaryUrl = URL.createObjectURL(file);
        const image = new Image();
        image.src = temporaryUrl;
        await image.decode();
        source = image;
      }
      const scale = Math.min(1, 320 / source.width, 320 / source.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(source.width * scale));
      canvas.height = Math.max(1, Math.round(source.height * scale));
      canvas
        .getContext("2d")!
        .drawImage(source, 0, 0, canvas.width, canvas.height);
      posterBlob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error("缩略图生成失败")),
          "image/webp",
          0.82,
        ),
      );
    } finally {
      if (source && "close" in source) source.close();
      if (temporaryUrl) URL.revokeObjectURL(temporaryUrl);
    }
  }
  const asset: Asset = {
    id: `asset-${crypto.randomUUID()}`,
    name: file.name,
    kind,
    blob: file,
    posterBlob,
    posterUrl:
      kind === "video" ? resolveMediaPath("/media/scene-1.svg") : undefined,
  };
  await db.assets.put(asset);
  return asset;
}
