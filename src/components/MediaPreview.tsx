import { useEffect, useState } from "react";
import { Film, Image as ImageIcon, LoaderCircle, X } from "lucide-react";
import { getAsset } from "../database";
import { selectNode, useGraph } from "../store";

export function MediaPreview() {
  const id = useGraph((s) => s.previewId);
  const node = useGraph((s) => selectNode(s, s.previewId));
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

