import { memo, useMemo } from "react";
import {
  Background, BackgroundVariant, Handle, Position, ReactFlow,
} from "@xyflow/react";
import type { NodeProps, ReactFlowProps } from "@xyflow/react";
import { ArrowRight, Film, Image as ImageIcon, Layers, Maximize2, Play } from "lucide-react";
import { buildOverview } from "../model";
import type {
  GraphNode,
  MediaNode as MediaNodeType,
  SummaryNode as SummaryNodeType,
} from "../model";
import { useGraph } from "../store";
import { Thumbnail } from "./Thumbnail";

const MediaNode = memo(function MediaNode({
  id,
  data,
  selected,
}: NodeProps<MediaNodeType>) {
  const compact = useGraph((s) => s.compact);
  return (
    <article
      className={`media-node ${selected ? "is-selected" : ""} ${compact ? "is-compact" : ""}`}
      data-node-id={id}
    >
      <Handle type="target" position={Position.Top} id="in" />
      <div className="node-cover">
        {!compact && <Thumbnail assetId={data.assetId} alt={data.title} />}
        <span className="node-kind">
          {data.kind === "video" ? <Film size={10} /> : <ImageIcon size={10} />}
          {data.kind === "video" ? "视频" : "图片"}
        </span>
        <button
          className="node-open nodrag nopan"
          title={`预览 ${data.title}`}
          aria-label={`预览 ${id}`}
          onClick={(event) => {
            event.stopPropagation();
            useGraph.setState({ previewId: id, selectedId: id });
          }}
        >
          {data.kind === "video" ? (
            <Play size={19} fill="currentColor" />
          ) : (
            <Maximize2 size={17} />
          )}
        </button>
        <span className="node-number">
          {String(data.order + 1).padStart(5, "0")}
        </span>
      </div>
      <div className="node-caption">
        <strong>{data.title}</strong>
        <span>
          {data.kind === "video" ? "MP4 · 点击预览" : "IMAGE · 缩略图"}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} id="out" />
    </article>
  );
});

const SummaryNode = memo(function SummaryNode({
  data,
}: NodeProps<SummaryNodeType>) {
  return (
    <article className={`summary-node ${data.count > 1 ? "has-cluster" : ""}`}>
      <div>
        <Layers size={13} />
        <strong>
          {data.count > 1
            ? `${data.count.toLocaleString()} 个节点`
            : data.title.slice(0, 5)}
        </strong>
      </div>
      <span>
        {data.count > 1 ? "点击展开子树" : "点击进入详情"}{" "}
        <ArrowRight size={10} />
      </span>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </article>
  );
});
const nodeTypes = { media: MediaNode, summary: SummaryNode };
const defaultEdgeOptions = {
  type: "straight",
  style: { stroke: "#aebcb7", strokeWidth: 1.4 },
  interactionWidth: 14,
};
const ignoreChanges = () => {};

type CanvasProps = Pick<ReactFlowProps<GraphNode>,
  "onNodesChange" | "isValidConnection" | "onNodeClick" | "onEdgeClick" |
  "onPaneClick" | "onNodeDragStop" | "onMoveEnd" | "onInit"
>;

export const GraphCanvas = memo(function GraphCanvas(props: CanvasProps) {
  const nodes = useGraph((state) => state.nodes);
  const edges = useGraph((state) => state.edges);
  const topology = useGraph((state) => state.topology);
  const overview = useGraph((state) => state.overview);
  const busy = useGraph((state) => state.busy);
  const culling = useGraph((state) => state.culling);
  const overviewGraph = useMemo(
    () => (overview ? buildOverview({ nodes, edges }, topology) : null),
    [overview, nodes, edges, topology],
  );
  return (
    <ReactFlow<GraphNode>
      {...props}
      nodes={overviewGraph?.nodes ?? nodes}
      edges={overviewGraph?.edges ?? edges}
      nodeTypes={nodeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      onlyRenderVisibleElements={culling}
      onEdgesChange={overview ? ignoreChanges : useGraph.getState().onEdgesChange}
      onConnect={useGraph.getState().connect}
      defaultViewport={useGraph.getState().viewport}
      minZoom={0.03}
      maxZoom={1.6}
      nodesDraggable={!overview && !busy}
      nodesConnectable={!overview && !busy}
      deleteKeyCode={overview || busy ? null : ["Backspace", "Delete"]}
      selectNodesOnDrag={true}
      edgesReconnectable={false}
      panOnScroll={false}
      zoomOnDoubleClick={false}
      elevateNodesOnSelect={false}
    >
      <Background variant={BackgroundVariant.Dots} color="#c9cec8" gap={22} size={1} />
    </ReactFlow>
  );
});
