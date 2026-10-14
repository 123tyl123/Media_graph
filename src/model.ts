import type { Edge, Node, Viewport, XYPosition } from "@xyflow/react";

export type MediaKind = "image" | "video";
export type MediaData = {
  title: string;
  kind: MediaKind;
  assetId: string;
  order: number;
  depth: number;
  [key: string]: unknown;
};
export type MediaNode = Node<MediaData, "media">;
export type SummaryData = {
  title: string;
  count: number;
  kind: MediaKind;
  realId: string;
  [key: string]: unknown;
};
export type SummaryNode = Node<SummaryData, "summary">;
export type GraphNode = MediaNode | SummaryNode;
export type GraphEdge = Edge;
export interface Graph {
  nodes: MediaNode[];
  edges: GraphEdge[];
}
export interface Topology {
  parent: Map<string, string>;
  children: Map<string, string[]>;
}
export interface Asset {
  id: string;
  kind: MediaKind;
  url?: string;
  posterUrl?: string;
  blob?: Blob;
  posterBlob?: Blob;
  name: string;
}
export interface GraphMeta {
  id: string;
  count: number;
  viewport: Viewport;
  savedAt: number;
  schemaVersion: number;
}
export interface StoredNode {
  graphId: string;
  id: string;
  position: XYPosition;
  data: MediaData;
}
export interface StoredEdge {
  graphId: string;
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export const WIDTH = 216;
export const HEIGHT = 176;
export const DEFAULT_VIEWPORT: Viewport = { x: 260, y: 64, zoom: 0.82 };
export const assetNames = [
  "远山与晨雾",
  "海岸的呼吸",
  "日落时分",
  "旷野漫游",
  "花园片刻",
  "山间来信",
];

export function generateGraph(count: number): Graph {
  const nodes: MediaNode[] = [];
  const edges: GraphEdge[] = [];
  for (let i = 0; i < count; i++) {
    const depth = Math.floor(Math.log2(i + 1));
    const start = 2 ** depth - 1;
    const inLevel = 2 ** depth;
    nodes.push({
      id: `node-${i}`,
      type: "media",
      width: WIDTH,
      height: HEIGHT,
      position: { x: (i - start - (inLevel - 1) / 2) * 278, y: depth * 258 },
      data: {
        title: `${assetNames[i % assetNames.length]} ${String(i + 1).padStart(5, "0")}`,
        kind: i % 2 ? "video" : "image",
        assetId: `sample-${i % 6}`,
        order: i,
        depth,
      },
    });
    if (i > 0)
      edges.push({
        id: `edge-${i}`,
        source: `node-${Math.floor((i - 1) / 2)}`,
        target: `node-${i}`,
      });
  }
  return { nodes, edges };
}

export function buildTopology(edges: GraphEdge[]): Topology {
  const parent = new Map<string, string>();
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    parent.set(edge.target, edge.source);
    const list = children.get(edge.source) ?? [];
    list.push(edge.target);
    children.set(edge.source, list);
  }
  return { parent, children };
}

export function connectionError(
  source: string,
  target: string,
  topology: Topology,
): string | null {
  if (source === target) return "节点不能连接自身";
  if ((topology.children.get(source) ?? []).includes(target))
    return "这条连线已存在";
  if (topology.parent.has(target)) return "目标已有父节点，请先断开原连线";
  if ((topology.children.get(source)?.length ?? 0) >= 2)
    return "每个节点最多连接两个子节点";
  const visited = new Set<string>();
  let cursor: string | undefined = source;
  while (cursor) {
    if (cursor === target || visited.has(cursor)) return "此连接会形成环";
    visited.add(cursor);
    cursor = topology.parent.get(cursor);
  }
  return null;
}

// Overview is a projection of the real forest. It never mutates the persisted graph.
export function buildOverview(
  graph: Graph,
  topology: Topology,
): { nodes: SummaryNode[]; edges: GraphEdge[] } {
  const lookup = new Map(graph.nodes.map((n) => [n.id, n]));
  const sizes = new Map<string, number>();
  const roots = graph.nodes.filter((n) => !topology.parent.has(n.id));
  const stack: [string, boolean][] = roots.map((n) => [n.id, false]);
  while (stack.length) {
    const [id, entered] = stack.pop()!;
    if (entered)
      sizes.set(
        id,
        1 +
          (topology.children.get(id) ?? []).reduce(
            (sum, child) => sum + (sizes.get(child) ?? 0),
            0,
          ),
      );
    else {
      stack.push([id, true]);
      for (const child of topology.children.get(id) ?? [])
        stack.push([child, false]);
    }
  }
  const nodes: SummaryNode[] = [];
  const edges: GraphEdge[] = [];
  let leaf = 0;
  const budget = 255;
  const visit = (id: string, depth: number): number => {
    const actual = lookup.get(id)!;
    const children = topology.children.get(id) ?? [];
    const childPositions =
      depth < 4 && nodes.length + roots.length < budget - 2
        ? children.map((child) => {
            const x = visit(child, depth + 1);
            edges.push({
              id: `summary-${id}-${child}`,
              source: id,
              target: child,
            });
            return x;
          })
        : [];
    const x = childPositions.length
      ? (childPositions[0] + childPositions[childPositions.length - 1]) / 2
      : leaf++ * 156;
    const collapsed = childPositions.length ? 1 : (sizes.get(id) ?? 1);
    nodes.push({
      id,
      type: "summary",
      position: { x, y: depth * 112 },
      width: 132,
      height: 62,
      draggable: false,
      connectable: false,
      data: {
        realId: id,
        title: actual.data.title,
        kind: actual.data.kind,
        count: collapsed,
      },
    });
    return x;
  };
  // If a user disconnects a very large forest, all roots remain accessible by ID search.
  for (const root of roots.slice(0, 63)) {
    visit(root.id, 0);
    leaf += 1;
  }
  return { nodes, edges };
}

export function toStoredNode(node: MediaNode): StoredNode {
  return {
    graphId: "main",
    id: node.id,
    position: node.position,
    data: node.data,
  };
}
export function fromStoredNode(node: StoredNode): MediaNode {
  return {
    id: node.id,
    type: "media",
    position: node.position,
    data: node.data,
    width: WIDTH,
    height: HEIGHT,
  };
}
export function toStoredEdge(edge: GraphEdge): StoredEdge {
  return {
    graphId: "main",
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
  };
}
