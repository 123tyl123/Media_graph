import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  useReactFlow,
  useStore as useFlowStore,
} from "@xyflow/react";
import type {
  NodeChange,
  NodeProps,
  ReactFlowInstance,
  ReactFlowProps,
  Viewport,
} from "@xyflow/react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Crosshair,
  Database,
  Expand,
  FileImage,
  Film,
  FolderOpen,
  GitBranch,
  Image as ImageIcon,
  Layers,
  Link2,
  LoaderCircle,
  Maximize2,
  Minus,
  MousePointer2,
  Play,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Unplug,
  Upload,
  X,
} from "lucide-react";
import {
  acquireThumbnail,
  getAsset,
  importAsset,
  releaseThumbnail,
  resolveMediaPath,
} from "./database";
import { buildOverview, connectionError } from "./model";
import type {
  GraphNode,
  MediaNode as MediaNodeType,
  SummaryNode as SummaryNodeType,
} from "./model";
import { exportGraph, useGraph } from "./store";

function useThumbnail(assetId: string) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let cancelled = false;
    let acquired = false;
    setUrl("");
    acquireThumbnail(assetId)
      .then((value) => {
        acquired = true;
        if (cancelled) releaseThumbnail(assetId);
        else setUrl(value);
      })
      .catch(() => {
        if (!cancelled) setUrl(resolveMediaPath("/media/scene-0.svg"));
      });
    return () => {
      cancelled = true;
      if (acquired) releaseThumbnail(assetId);
    };
  }, [assetId]);
  return url;
}

function Thumbnail({
  assetId,
  alt,
  ...props
}: {
  assetId: string;
  alt: string;
  className?: string;
}) {
  const url = useThumbnail(assetId);
  return url ? (
    <img
      {...props}
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={(event) => {
        event.currentTarget.onerror = null;
        event.currentTarget.src = resolveMediaPath("/media/scene-0.svg");
      }}
    />
  ) : (
    <div className="thumbnail-loading" />
  );
}

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

function LiveMetrics() {
  const [fps, setFps] = useState<number | null>(null);
  const zoom = useFlowStore((s) => Math.round(s.transform[2] * 100));
  const [visible, setVisible] = useState(0);
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let start = performance.now();
    const tick = (now: number) => {
      frames++;
      if (now - start > 1000) {
        setFps(Math.round((frames * 1000) / (now - start)));
        setVisible(document.querySelectorAll(".react-flow__node").length);
        start = now;
        frames = 0;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="live-metrics">
      <span className="live-dot" />
      <b>{fps ?? "—"} FPS</b>
      <span className="metrics-divider" />
      <span>当前挂载 {visible}</span>
      <span className="metrics-divider" />
      <span>{zoom}%</span>
    </div>
  );
}

interface PanSample {
  buildMode: string;
  count: number;
  edges: number;
  culling: boolean;
  overview: boolean;
  averageFPS: number;
  p95FrameMs: number;
  maxLongTaskMs: number;
  mounted: number;
  viewport: string;
  graphLoadMs: number;
  measuredAt: string;
}

function BrowserSampler() {
  const flow = useReactFlow();
  const [sampling, setSampling] = useState(false);
  const [samples, setSamples] = useState<PanSample[]>([]);
  const raf = useRef(0);
  const observerRef = useRef<PerformanceObserver | null>(null);
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      observerRef.current?.disconnect();
    },
    [],
  );
  const run = () => {
    const state = useGraph.getState();
    if (sampling || state.busy) return;
    setSampling(true);
    const origin = flow.getViewport();
    const started = performance.now();
    let previous = started;
    const frames: number[] = [];
    const tasks: number[] = [];
    if (
      typeof PerformanceObserver !== "undefined" &&
      PerformanceObserver.supportedEntryTypes.includes("longtask")
    ) {
      const observer = new PerformanceObserver((list) =>
        tasks.push(...list.getEntries().map((item) => item.duration)),
      );
      observer.observe({ type: "longtask", buffered: false });
      observerRef.current = observer;
    }
    const tick = (now: number) => {
      frames.push(now - previous);
      previous = now;
      const elapsed = now - started;
      void flow.setViewport({
        x: origin.x + Math.sin(elapsed / 400) * 95,
        y: origin.y + Math.sin(elapsed / 530) * 55,
        zoom: origin.zoom,
      });
      if (elapsed < 3000) {
        raf.current = requestAnimationFrame(tick);
        return;
      }
      const observer = observerRef.current;
      if (observer) {
        tasks.push(...observer.takeRecords().map((item) => item.duration));
        observer.disconnect();
        observerRef.current = null;
      }
      void flow.setViewport(origin);
      const sorted = frames.slice(1).sort((a, b) => a - b);
      const sample: PanSample = {
        buildMode: import.meta.env.PROD ? 'production' : 'development',
        count: state.nodes.length,
        edges: state.edges.length,
        culling: state.culling,
        overview: state.overview,
        averageFPS: Math.round(((frames.length * 1000) / elapsed) * 10) / 10,
        p95FrameMs:
          Math.round((sorted[Math.floor(sorted.length * 0.95)] ?? 0) * 10) / 10,
        maxLongTaskMs: Math.round(Math.max(0, ...tasks)),
        mounted: document.querySelectorAll(".react-flow__node").length,
        viewport: `${document.documentElement.clientWidth}×${document.documentElement.clientHeight}`,
        graphLoadMs: Math.round(state.loadMs),
        measuredAt: new Date().toISOString(),
      };
      setSamples((items) => [...items, sample]);
      setSampling(false);
    };
    raf.current = requestAnimationFrame(tick);
  };
  const exportSamples = () => {
    const payload = {
      method:
        "3-second requestAnimationFrame-driven React Flow viewport panning; see each sample buildMode; sample images and one video are reused. Does not measure physical dragging or media decoding.",
      userAgent: navigator.userAgent,
      samples,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "frame-browser-samples.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return (
    <div className="sampler">
      <button className="outline-button" disabled={sampling} onClick={run}>
        {sampling ? (
          <LoaderCircle className="spin" size={13} />
        ) : (
          <Play size={13} />
        )}
        {sampling ? "正在平移采样…" : "运行 3 秒平移采样"}
      </button>
      {samples.length > 0 && (
        <>
          <div className="sampler-result" data-testid="pan-result">
            <strong>{samples.at(-1)!.averageFPS} FPS</strong>
            <span>
              P95 {samples.at(-1)!.p95FrameMs} ms · 最长任务{" "}
              {samples.at(-1)!.maxLongTaskMs} ms
            </span>
            <small>
              {samples.at(-1)!.count.toLocaleString()} 节点 · 挂载{" "}
              {samples.at(-1)!.mounted} · {samples.at(-1)!.viewport}
            </small>
          </div>
          <button className="sampler-export" onClick={exportSamples}>
            导出 {samples.length} 组采样记录 <ArrowDownToLine size={11} />
          </button>
        </>
      )}
      <p>自动平移采样为当前视口的结果；请在生产构建和实际素材条件下复测。</p>
    </div>
  );
}

function MediaPreview() {
  const id = useGraph((s) => s.previewId);
  const node = useGraph((s) => s.nodes.find((n) => n.id === s.previewId));
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!node) return;
    let cancelled = false;
    let blobUrl: string | undefined;
    setSource("");
    setError("");
    getAsset(node.data.assetId)
      .then((asset) => {
        if (!asset) throw new Error("媒体文件不存在");
        if (cancelled) return;
        blobUrl = asset.blob ? URL.createObjectURL(asset.blob) : undefined;
        setSource(blobUrl ?? asset.url ?? "");
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [node?.data.assetId]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") useGraph.setState({ previewId: null });
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  if (!id || !node) return null;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget)
          useGraph.setState({ previewId: null });
      }}
    >
      <section
        className="preview-modal"
        role="dialog"
        aria-modal="true"
        aria-label="媒体预览"
      >
        <header>
          <span>
            {node.data.kind === "video" ? (
              <Film size={18} />
            ) : (
              <ImageIcon size={18} />
            )}
            <strong>{node.data.title}</strong>
            <span className="mono">{node.id}</span>
          </span>
          <button
            className="icon-button"
            aria-label="关闭预览"
            onClick={() => useGraph.setState({ previewId: null })}
          >
            <X size={20} />
          </button>
        </header>
        <div className="preview-content">
          {error ? (
            <p>{error}</p>
          ) : source ? (
            node.data.kind === "video" ? (
              <video
                key={`${id}-${source}`}
                src={source}
                controls
                preload="none"
                autoPlay
                playsInline
                onError={() => setError("视频加载失败，请替换素材后重试")}
              />
            ) : (
              <img src={source} alt={node.data.title} />
            )
          ) : (
            <LoaderCircle className="spin" />
          )}
        </div>
        <footer>媒体按需加载 · 原始素材保存在本地或随项目提供</footer>
      </section>
    </div>
  );
}

function Inspector({ focusNode }: { focusNode: (id: string) => void }) {
  const selected = useGraph((s) => s.nodes.find((n) => n.id === s.selectedId));
  const topology = useGraph((s) => s.topology);
  const edges = useGraph((s) => s.edges);
  const busy = useGraph((s) => s.busy);
  const [connectingTo, setConnectingTo] = useState("");
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  if (!selected)
    return (
      <aside className="inspector">
        <div className="inspector-title">
          节点详情 <SlidersHorizontal size={15} />
        </div>
        <div className="empty-inspector">
          <MousePointer2 size={28} />
          <p>选择一个节点</p>
          <span>查看媒体与连接关系</span>
        </div>
      </aside>
    );
  const parent = topology.parent.get(selected.id);
  const children = topology.children.get(selected.id) ?? [];
  const parentEdge = parent
    ? edges.find((e) => e.target === selected.id)
    : undefined;
  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    try {
      const asset = await importAsset(file);
      useGraph
        .getState()
        .replaceMedia(selected.id, asset.id, asset.kind, file.name);
    } catch (error) {
      useGraph.setState({ notice: `素材导入失败：${String(error)}` });
    } finally {
      setImporting(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };
  return (
    <aside className="inspector">
      <div className="inspector-title">
        节点详情 <SlidersHorizontal size={15} />
      </div>
      <div className="inspector-scroll">
        <div className="inspector-cover">
          <Thumbnail
            assetId={selected.data.assetId}
            alt={selected.data.title}
          />
          <button
            className="inspector-play"
            aria-label="预览选中媒体"
            onClick={() => useGraph.setState({ previewId: selected.id })}
          >
            {selected.data.kind === "video" ? (
              <Play fill="currentColor" size={20} />
            ) : (
              <Expand size={20} />
            )}
          </button>
        </div>
        <div className="type-pill">
          {selected.data.kind === "video" ? (
            <Film size={12} />
          ) : (
            <ImageIcon size={12} />
          )}
          {selected.data.kind === "video" ? "视频节点" : "图片节点"}
        </div>
        <h2>{selected.data.title}</h2>
        <p className="inspector-id mono" data-testid="selected-id">
          {selected.id}
        </p>
        <div className="property-grid">
          <span>初始层级</span>
          <b>L{selected.data.depth + 1}</b>
          <span>坐标 X</span>
          <b data-testid="position-x">{Math.round(selected.position.x)}</b>
          <span>坐标 Y</span>
          <b data-testid="position-y">{Math.round(selected.position.y)}</b>
          <span>子节点</span>
          <b>{children.length} / 2</b>
        </div>
        <div className="inspector-section">
          <h3>
            连接关系 <GitBranch size={14} />
          </h3>
          <label>父节点</label>
          {parent ? (
            <div className="relation-row">
              <button onClick={() => focusNode(parent)}>
                <span className="relation-dot" />
                {parent}
                <ChevronRight size={13} />
              </button>
              <button
                className="icon-button disconnect"
                title="断开父节点连线"
                aria-label="断开父节点连线"
                disabled={busy}
                onClick={() =>
                  parentEdge && useGraph.getState().disconnect(parentEdge.id)
                }
              >
                <Unplug size={14} />
              </button>
            </div>
          ) : (
            <div className="relation-empty">根节点 / 待连接子树</div>
          )}
          <label>子节点</label>
          {children.length ? (
            children.map((id) => (
              <div className="relation-row" key={id}>
                <button onClick={() => focusNode(id)}>
                  <span className="relation-dot coral" />
                  {id}
                  <ChevronRight size={13} />
                </button>
                <button
                  className="icon-button disconnect"
                  aria-label={`断开 ${id}`}
                  onClick={() => {
                    const edge = edges.find(
                      (e) => e.source === selected.id && e.target === id,
                    );
                    if (edge) useGraph.getState().disconnect(edge.id);
                  }}
                  disabled={busy}
                >
                  <Unplug size={14} />
                </button>
              </div>
            ))
          ) : (
            <div className="relation-empty">暂无子节点</div>
          )}
          <form
            className="connect-form"
            onSubmit={(event) => {
              event.preventDefault();
              const target = connectingTo.startsWith("node-")
                ? connectingTo
                : `node-${connectingTo}`;
              useGraph.getState().connect({
                source: selected.id,
                target,
                sourceHandle: "out",
                targetHandle: "in",
              });
            }}
          >
            <input
              value={connectingTo}
              onChange={(event) => setConnectingTo(event.target.value)}
              placeholder="子节点 ID，如 9999"
              aria-label="连接目标节点"
            />
            <button
              className="icon-button"
              disabled={busy || !connectingTo}
              title="连接子节点"
              aria-label="连接子节点"
            >
              <Link2 size={16} />
            </button>
          </form>
        </div>
        <button
          className="outline-button import-button"
          disabled={importing || busy}
          onClick={() => inputRef.current?.click()}
        >
          {importing ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <Upload size={15} />
          )}
          替换为本地素材
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          hidden
          onChange={(event) => void handleImport(event.target.files?.[0])}
        />
        <p className="local-note">
          <Database size={12} />
          素材与图谱仅存于当前浏览器
        </p>
      </div>
      <div className="inspector-foot">
        <CircleHelp size={14} />
        拖动连接点，或输入 ID 建立连线
      </div>
    </aside>
  );
}

export function App() {
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const topology = useGraph((s) => s.topology);
  const ready = useGraph((s) => s.ready);
  const busy = useGraph((s) => s.busy);
  const overview = useGraph((s) => s.overview);
  const culling = useGraph((s) => s.culling);
  const saveState = useGraph((s) => s.saveState);
  const notice = useGraph((s) => s.notice);
  const loadMs = useGraph((s) => s.loadMs);
  const selectedEdge = useGraph((s) => s.selectedEdge);
  const [search, setSearch] = useState("");
  const [dataset, setDataset] = useState(10_000);
  const [resetOpen, setResetOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [flowReady, setFlowReady] = useState(false);
  const flow = useReactFlow<GraphNode>();
  const canvas = useRef<HTMLDivElement>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const overviewGraph = useMemo(
    () => (overview ? buildOverview({ nodes, edges }, topology) : null),
    [overview, nodes, edges, topology],
  );

  useEffect(() => {
    void useGraph.getState().initialize();
  }, []);
  useEffect(() => {
    if (ready) setDataset(nodes.length);
  }, [ready, nodes.length]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => {
        if (
          useGraph.getState().notice === notice &&
          useGraph.getState().saveState !== "error"
        )
          useGraph.setState({ notice: "" });
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  useEffect(
    () => () => {
      if (focusTimer.current) clearTimeout(focusTimer.current);
    },
    [],
  );

  const focusNode = useCallback(
    (id: string) => {
      const node = useGraph.getState().nodes.find((n) => n.id === id);
      if (!node) {
        useGraph.setState({
          notice: "未找到该节点，请输入 0 到节点数减 1 的 ID",
        });
        return;
      }
      useGraph.setState((state) => ({
        nodes: state.nodes.map((item) =>
          item.id === id
            ? { ...item, selected: true }
            : item.selected
              ? { ...item, selected: false }
              : item,
        ),
        selectedId: id,
        selectedEdge: null,
        overview: false,
        compact: false,
      }));
      if (focusTimer.current) clearTimeout(focusTimer.current);
      focusTimer.current = setTimeout(() => {
        const bounds = canvas.current?.getBoundingClientRect();
        const zoom = 0.85;
        void flow.setViewport(
          {
            x: (bounds?.width ?? 900) / 2 - (node.position.x + 108) * zoom,
            y: (bounds?.height ?? 700) / 2 - (node.position.y + 88) * zoom,
            zoom,
          },
          { duration: 240 },
        );
      }, 30);
    },
    [flow],
  );
  const showOverview = useCallback(() => {
    useGraph.setState({ overview: true, compact: false, selectedEdge: null });
    if (focusTimer.current) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => {
      void flow.fitView({
        padding: 0.14,
        duration: 300,
        minZoom: 0.06,
        maxZoom: 1,
      });
    }, 50);
  }, [flow]);
  const handleNodeChanges = useCallback((changes: NodeChange<GraphNode>[]) => {
    if (!useGraph.getState().overview)
      useGraph.getState().onNodesChange(changes as NodeChange<MediaNodeType>[]);
  }, []);
  const handleNodeClick = useCallback<
    NonNullable<ReactFlowProps<GraphNode>["onNodeClick"]>
  >(
    (_event, node) => {
      if (useGraph.getState().overview) focusNode(node.id);
      else useGraph.setState({ selectedId: node.id, selectedEdge: null });
    },
    [focusNode],
  );
  const handleEdgeClick = useCallback<
    NonNullable<ReactFlowProps<GraphNode>["onEdgeClick"]>
  >((_event, edge) => {
    if (!useGraph.getState().overview)
      useGraph.setState({ selectedEdge: edge.id });
  }, []);
  const handlePaneClick = useCallback(
    () => useGraph.setState({ selectedEdge: null }),
    [],
  );
  const handleDragStop = useCallback<
    NonNullable<ReactFlowProps<GraphNode>["onNodeDragStop"]>
  >((_event, node) => {
    if (node.type === "media")
      useGraph.getState().savePosition(node as MediaNodeType);
  }, []);
  const validateConnection = useCallback<
    NonNullable<ReactFlowProps<GraphNode>["isValidConnection"]>
  >(
    (connection) =>
      !connectionError(
        connection.source,
        connection.target,
        useGraph.getState().topology,
      ),
    [],
  );
  const onInit = useCallback((_instance: ReactFlowInstance<GraphNode>) => {
    setFlowReady(true);
  }, []);
  const onMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      const state = useGraph.getState();
      if (!state.overview) {
        if (viewport.zoom < 0.24) {
          showOverview();
          return;
        }
        if (viewport.zoom < 0.53 && !state.compact)
          useGraph.setState({ compact: true });
        if (viewport.zoom > 0.62 && state.compact)
          useGraph.setState({ compact: false });
        if (!state.busy) state.saveViewport(viewport);
      }
    },
    [showOverview],
  );
  useEffect(() => {
    if (!ready || !flowReady) return;
    const saved = useGraph.getState().viewport;
    void flow.setViewport(saved);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        performance.mark("frame-ready");
      }),
    );
  }, [ready, flowReady, flow]);
  useEffect(() => {
    const diagnostics = () => ({
      count: useGraph.getState().nodes.length,
      edges: useGraph.getState().edges.length,
      renderedNodes: document.querySelectorAll(".react-flow__node").length,
      overview: useGraph.getState().overview,
      saveState: useGraph.getState().saveState,
      loadMs: useGraph.getState().loadMs,
      readyMs:
        performance.getEntriesByName("frame-ready")[0]?.startTime ?? null,
      players: document.querySelectorAll("video").length,
    });
    Object.assign(window, { frameDiagnostics: diagnostics });
  }, []);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const value = search.trim();
    if (value)
      focusNode(value.startsWith("node-") ? value : `node-${Number(value)}`);
  };
  const saveLabel = {
    loading: "正在读取",
    saved: "已保存到本地",
    pending: "等待保存",
    saving: "正在保存",
    error: "保存异常",
  }[saveState];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="FRAME 首页">
          <span className="brand-mark">
            <i />
            <i />
            <i />
            <i />
          </span>
          FRAME<span className="brand-beta">LAB</span>
        </a>
        <div className="workspace-label">
          WORKSPACE <span>01</span>
        </div>
        <div className="workspace-card">
          <span className="workspace-icon">
            <FolderOpen size={18} />
          </span>
          <div>
            <strong>媒体图谱实验室</strong>
            <span>本地工作空间</span>
          </div>
          <ChevronDown size={14} />
        </div>
        <nav>
          <button
            className="nav-item active"
            onClick={() => focusNode("node-0")}
          >
            <GitBranch size={17} />
            图谱画布<span>01</span>
          </button>
          <button
            className={`nav-item ${showStats ? "secondary-active" : ""}`}
            onClick={() => setShowStats((value) => !value)}
          >
            <SlidersHorizontal size={17} />
            性能观察
            <ChevronRight size={13} />
          </button>
          <button className="nav-item" onClick={() => setHelpOpen(true)}>
            <CircleHelp size={17} />
            使用指南
            <ChevronRight size={13} />
          </button>
        </nav>
        <div className="sidebar-separator" />
        <div className="section-label">
          数据集 <span>LOCAL</span>
        </div>
        <div className="dataset-options">
          {[100, 1000, 10_000].map((count) => (
            <button
              key={count}
              aria-label={`${count} 节点数据集`}
              className={nodes.length === count ? "chosen" : ""}
              onClick={() => {
                setDataset(count);
                setResetOpen(true);
              }}
              disabled={busy}
            >
              <Database size={14} />
              <span>{count.toLocaleString()} 个节点</span>
              {nodes.length === count ? (
                <span className="dataset-dot" />
              ) : (
                <ChevronRight size={12} />
              )}
            </button>
          ))}
        </div>
        <div className="sidebar-tip">
          <Sparkles size={18} />
          <strong>每个灵感，都有连接。</strong>
          <p>
            在万千画面之间，
            <br />
            找到属于你的创作脉络。
          </p>
          <div className="tip-art">
            <span />
            <span />
            <span />
            <i />
            <i />
          </div>
        </div>
        <div className="sidebar-bottom">
          <span className="avatar">T</span>
          <div>
            <strong>Test 项目</strong>
            <span>离线优先 · IndexedDB</span>
          </div>
          <span className="online-dot" />
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            工作空间
            <ChevronRight size={13} />
            <span>媒体图谱实验室</span>
          </div>
          <div
            className={`save-status ${saveState === "error" ? "status-error" : ""}`}
            role="status"
          >
            {saveState === "saved" ? (
              <Check size={14} />
            ) : saveState === "saving" || saveState === "loading" ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <span className="pending-dot" />
            )}
            {saveLabel}
          </div>
          <button
            className="outline-button export-button"
            onClick={() =>
              void exportGraph().catch((error) =>
                useGraph.setState({ notice: `导出失败：${String(error)}` }),
              )
            }
          >
            <ArrowDownToLine size={14} />
            导出图数据
          </button>
          <button
            className="primary-button"
            onClick={() => void useGraph.getState().flush()}
            disabled={!ready || busy}
          >
            <Save size={14} />
            保存
          </button>
        </header>
        <section className="page-heading">
          <div>
            <div className="eyebrow">CONNECT YOUR IDEAS</div>
            <h1>
              媒体图谱<span>Media graph</span>
            </h1>
            <p>让图片与影像，在同一张画布上自由生长。</p>
          </div>
          <div className="graph-summary">
            <div>
              <strong data-testid="node-count">
                {nodes.length.toLocaleString()}
              </strong>
              <span>媒体节点</span>
            </div>
            <i />
            <div>
              <strong data-testid="edge-count">
                {edges.length.toLocaleString()}
              </strong>
              <span>关联连线</span>
            </div>
          </div>
        </section>
        <div className="workbench">
          <div className="canvas-column">
            <div className="canvas-toolbar">
              <div className="view-tabs">
                <button
                  className={!overview ? "selected" : ""}
                  onClick={() =>
                    focusNode(useGraph.getState().selectedId ?? "node-0")
                  }
                >
                  <MousePointer2 size={14} />
                  详情
                </button>
                <button
                  className={overview ? "selected" : ""}
                  onClick={showOverview}
                >
                  <Layers size={14} />
                  全图总览
                </button>
              </div>
              <form className="search-box" onSubmit={submitSearch}>
                <Search size={14} />
                <input
                  aria-label="定位节点 ID"
                  placeholder="定位节点 ID，如 9999"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <kbd>↵</kbd>
              </form>
              <button
                className="icon-button toolbar-help"
                aria-label="打开使用指南"
                onClick={() => setHelpOpen(true)}
              >
                <CircleHelp size={17} />
              </button>
            </div>
            <div
              className={`canvas ${overview ? "overview-canvas" : ""}`}
              ref={canvas}
              data-testid="graph-canvas"
            >
              {ready ? (
                <ReactFlow<GraphNode>
                  nodes={overviewGraph?.nodes ?? nodes}
                  edges={overviewGraph?.edges ?? edges}
                  nodeTypes={nodeTypes}
                  defaultEdgeOptions={defaultEdgeOptions}
                  onlyRenderVisibleElements={culling}
                  onNodesChange={handleNodeChanges}
                  onEdgesChange={
                    overview ? ignoreChanges : useGraph.getState().onEdgesChange
                  }
                  onConnect={useGraph.getState().connect}
                  isValidConnection={validateConnection}
                  onNodeClick={handleNodeClick}
                  onEdgeClick={handleEdgeClick}
                  onPaneClick={handlePaneClick}
                  onNodeDragStop={handleDragStop}
                  onMoveEnd={onMoveEnd}
                  onInit={onInit}
                  defaultViewport={useGraph.getState().viewport}
                  minZoom={0.03}
                  maxZoom={1.6}
                  nodesDraggable={!overview && !busy}
                  nodesConnectable={!overview && !busy}
                  deleteKeyCode={
                    overview || busy ? null : ["Backspace", "Delete"]
                  }
                  selectNodesOnDrag={true}
                  edgesReconnectable={false}
                  panOnScroll={false}
                  zoomOnDoubleClick={false}
                  elevateNodesOnSelect={false}
                >
                  <Background
                    variant={BackgroundVariant.Dots}
                    color="#c9cec8"
                    gap={22}
                    size={1}
                  />
                </ReactFlow>
              ) : (
                <div className="loading-state">
                  <LoaderCircle className="spin" size={28} />
                  <strong>正在打开你的图谱</strong>
                  <span>生成节点 · 建立连接 · 读取本地数据</span>
                </div>
              )}
              <div className="canvas-mode-label">
                <span className="canvas-mode-dot" />
                {overview
                  ? "聚合总览 · 点击子树进入详情"
                  : "自由画布 · 二叉树结构"}
              </div>
              {selectedEdge && !overview && (
                <div className="edge-action">
                  <Link2 size={14} />
                  <span>已选中连线</span>
                  <button
                    onClick={() => useGraph.getState().disconnect(selectedEdge)}
                  >
                    <Unplug size={13} />
                    断开
                  </button>
                </div>
              )}
              <div className="canvas-controls">
                <button
                  aria-label="放大"
                  title="放大"
                  onClick={() => void flow.zoomIn({ duration: 150 })}
                >
                  <Plus size={18} />
                </button>
                <button
                  aria-label="缩小"
                  title="缩小"
                  onClick={() => void flow.zoomOut({ duration: 150 })}
                >
                  <Minus size={18} />
                </button>
                <i />
                <button
                  aria-label="回到根节点"
                  title="回到根节点"
                  onClick={() => focusNode("node-0")}
                >
                  <Crosshair size={18} />
                </button>
                <button
                  aria-label="查看全图"
                  title="查看全图"
                  onClick={showOverview}
                >
                  <Maximize2 size={17} />
                </button>
              </div>
              <div className="canvas-legend">
                <span>
                  <i className="image-dot" />
                  图片
                </span>
                <span>
                  <i className="video-dot" />
                  视频
                </span>
                {overview && (
                  <span>
                    <i className="cluster-dot" />
                    子树聚合
                  </span>
                )}
              </div>
            </div>
            <footer className="canvas-footer">
              <span>
                <MousePointer2 size={12} />
                拖拽节点 <i />
                滚轮缩放 <i />
                拖动画布平移
              </span>
              <LiveMetrics />
            </footer>
          </div>
          <Inspector focusNode={focusNode} />
        </div>
        <footer className="page-footer">
          <span>
            <Database size={12} />
            本地优先，专注创作
          </span>
          <span>
            FRAME / MEDIA EXPLORER <b>V1.0</b>
          </span>
        </footer>
      </main>
      {notice && (
        <div
          className={`toast ${saveState === "error" ? "error-toast" : ""}`}
          role="alert"
        >
          <span>{notice}</span>
          <button
            aria-label="关闭提示"
            onClick={() => useGraph.setState({ notice: "" })}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {showStats && (
        <div className="stats-panel">
          <header>
            <SlidersHorizontal size={16} />
            <strong>性能观察</strong>
            <button
              className="icon-button"
              aria-label="关闭性能观察"
              onClick={() => setShowStats(false)}
            >
              <X size={17} />
            </button>
          </header>
          <div className="stat-line">
            <span>逻辑节点 / 连线</span>
            <b>
              {nodes.length} / {edges.length}
            </b>
          </div>
          <div className="stat-line">
            <span>图数据初始化</span>
            <b>{Math.round(loadMs)} ms</b>
          </div>
          <div className="stat-line">
            <span>当前显示策略</span>
            <b>{overview ? "子树聚合" : "视口裁剪"}</b>
          </div>
          <label className="culling-toggle">
            <input
              type="checkbox"
              checked={culling}
              disabled={busy}
              onChange={(event) =>
                useGraph.setState({ culling: event.target.checked })
              }
            />
            视口裁剪（关闭可测试全量基线）
          </label>
          <p>
            FPS 为当前窗口的实时采样，空闲 FPS 不等于拖拽性能。示例复用 6
            张封面、1 个视频；完整图数据始终保留。
          </p>
          <BrowserSampler />
        </div>
      )}
      {resetOpen && (
        <div className="modal-backdrop">
          <section
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-label="重新生成数据集"
          >
            <div className="dialog-icon">
              <Database size={23} />
            </div>
            <h2>切换到 {dataset.toLocaleString()} 个节点？</h2>
            <p>
              将重新生成二叉树，并覆盖当前图的位置与连线。已导入的媒体文件会保留在本地素材库。
            </p>
            <div className="dialog-actions">
              <button
                className="outline-button"
                onClick={() => setResetOpen(false)}
              >
                取消
              </button>
              <button
                className="primary-button"
                disabled={busy}
                onClick={async () => {
                  setResetOpen(false);
                  await useGraph.getState().regenerate(dataset);
                  focusNode("node-0");
                }}
              >
                确认重新生成
              </button>
            </div>
          </section>
        </div>
      )}
      {helpOpen && (
        <div className="modal-backdrop">
          <section
            className="help-modal"
            role="dialog"
            aria-modal="true"
            aria-label="使用指南"
          >
            <header>
              <div>
                <span className="eyebrow">A LITTLE GUIDE</span>
                <h2>在画布上，自由连接。</h2>
              </div>
              <button
                className="icon-button"
                aria-label="关闭使用指南"
                onClick={() => setHelpOpen(false)}
              >
                <X size={20} />
              </button>
            </header>
            <div className="help-grid">
              <div>
                <MousePointer2 />
                <h3>移动与探索</h3>
                <p>
                  拖拽卡片改变位置，拖动空白平移画布，滚轮缩放。输入 ID
                  可到达任意节点。
                </p>
              </div>
              <div>
                <GitBranch />
                <h3>建立连接</h3>
                <p>
                  先断开目标节点的父连线，再从卡片底部连接点拖向目标顶部。每个父节点最多两个子节点。
                </p>
              </div>
              <div>
                <FileImage />
                <h3>预览与替换</h3>
                <p>
                  点击封面上的预览按钮；在右侧替换本地图片或视频。视频仅在预览时创建播放器。
                </p>
              </div>
              <div>
                <Layers />
                <h3>从万点到一眼</h3>
                <p>
                  总览以聚合卡片表示子树，数量包含其全部后代。点击卡片进入真实节点，全部数据保留。
                </p>
              </div>
            </div>
            <div className="help-note">
              <Database size={16} />
              <p>
                等顶部显示“已保存到本地”后再关闭。数据仅存在当前浏览器；导出的
                JSON 包含图结构，不包含导入媒体的二进制文件。
              </p>
            </div>
            <button
              className="primary-button"
              onClick={() => setHelpOpen(false)}
            >
              开始探索 <ArrowRight size={15} />
            </button>
          </section>
        </div>
      )}
      <MediaPreview />
      {busy && (
        <div className="busy-overlay">
          <LoaderCircle className="spin" />
          <span>正在切换数据集…</span>
        </div>
      )}
    </div>
  );
}
