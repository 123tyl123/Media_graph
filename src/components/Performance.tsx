import { useEffect, useRef, useState } from "react";
import { useReactFlow, useStore as useFlowStore } from "@xyflow/react";
import { ArrowDownToLine, LoaderCircle, Play } from "lucide-react";
import { useGraph } from "../store";

export function LiveMetrics() {
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

export function BrowserSampler() {
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

