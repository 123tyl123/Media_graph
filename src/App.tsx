import { useCallback, useEffect, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import type {
  NodeChange,
  ReactFlowInstance,
  ReactFlowProps,
  Viewport,
} from "@xyflow/react";
import {
  ArrowDownToLine, ArrowRight, Check, ChevronDown, ChevronRight, CircleHelp,
  Crosshair, Database, FileImage, FolderOpen, GitBranch, Layers, Link2,
  LoaderCircle, Maximize2, Minus, MousePointer2, Plus, Save, Search,
  SlidersHorizontal, Sparkles, Unplug, X,
} from "lucide-react";
import { connectionError } from "./model";
import type { GraphNode, MediaNode as MediaNodeType } from "./model";
import { exportGraph, selectNode, useGraph } from "./store";
import { GraphCanvas } from "./components/GraphCanvas";
import { Inspector } from "./components/Inspector";
import { MediaPreview } from "./components/MediaPreview";
import { BrowserSampler, LiveMetrics } from "./components/Performance";

let appCommits = 0;

export function App() {
  // Count committed shell updates, including in production browser measurements.
  useEffect(() => {
    appCommits++;
  });
  const nodeCount = useGraph((s) => s.nodes.length);
  const edgeCount = useGraph((s) => s.edges.length);
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

  useEffect(() => {
    void useGraph.getState().initialize();
  }, []);
  useEffect(() => {
    if (ready) setDataset(nodeCount);
  }, [ready, nodeCount]);
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
      const state = useGraph.getState();
      const node = selectNode(state, id);
      const wasOverview = state.overview;
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
        const target = {
          x: (bounds?.width ?? 900) / 2 - (node.position.x + 108) * zoom,
          y: (bounds?.height ?? 700) / 2 - (node.position.y + 88) * zoom,
          zoom,
        };
        const current = flow.getViewport();
        const distance = Math.hypot(target.x - current.x, target.y - current.y);
        // A distant animated flight can expose thousands of cards between endpoints.
        const animate = !wasOverview && distance < Math.max(bounds?.width ?? 900, bounds?.height ?? 700) * 2;
        void flow.setViewport(target, { duration: animate ? 240 : 0 });
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
      appCommits,
      buildMode: import.meta.env.MODE,
      culling: useGraph.getState().culling,
      busy: useGraph.getState().busy,
      count: useGraph.getState().nodes.length,
      edges: useGraph.getState().edges.length,
      renderedNodes: document.querySelectorAll(".react-flow__node").length,
      overview: useGraph.getState().overview,
      saveState: useGraph.getState().saveState,
      persistenceBlocked: useGraph.getState().persistenceBlocked,
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
              className={nodeCount === count ? "chosen" : ""}
              onClick={() => {
                setDataset(count);
                setResetOpen(true);
              }}
              disabled={busy}
            >
              <Database size={14} />
              <span>{count.toLocaleString()} 个节点</span>
              {nodeCount === count ? (
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
                {nodeCount.toLocaleString()}
              </strong>
              <span>媒体节点</span>
            </div>
            <i />
            <div>
              <strong data-testid="edge-count">
                {edgeCount.toLocaleString()}
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
                <GraphCanvas
                  onNodesChange={handleNodeChanges}
                  isValidConnection={validateConnection}
                  onNodeClick={handleNodeClick}
                  onEdgeClick={handleEdgeClick}
                  onPaneClick={handlePaneClick}
                  onNodeDragStop={handleDragStop}
                  onMoveEnd={onMoveEnd}
                  onInit={onInit}
                />
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
              {nodeCount} / {edgeCount}
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
