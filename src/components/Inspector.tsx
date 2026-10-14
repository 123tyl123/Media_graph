import { useRef, useState } from "react";
import {
  ChevronRight, CircleHelp, Database, Expand, Film, GitBranch,
  Image as ImageIcon, Link2, LoaderCircle, MousePointer2, Play,
  SlidersHorizontal, Unplug, Upload,
} from "lucide-react";
import { importAsset } from "../database";
import { selectNode, useGraph } from "../store";
import { Thumbnail } from "./Thumbnail";

export function Inspector({ focusNode }: { focusNode: (id: string) => void }) {
  const selected = useGraph((s) => selectNode(s, s.selectedId));
  const topology = useGraph((s) => s.topology);
  const edges = useGraph((s) => s.edges);
  const busy = useGraph((s) => s.busy);
  const persistenceBlocked = useGraph((s) => s.persistenceBlocked);
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
          disabled={importing || busy || persistenceBlocked}
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

