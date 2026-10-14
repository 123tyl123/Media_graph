import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(project, ".browser-cache");
const label = process.env.BENCHMARK_LABEL ?? "current";
assert.match(label, /^[a-zA-Z0-9_-]{1,32}$/);
const { chromium } = await import("@playwright/test");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.setDefaultTimeout(20000);
const report = {
  label,
  date: new Date().toISOString(),
  browser: await browser.version(),
  platform: `${os.platform()} ${os.release()}`,
  cpu: os.cpus()[0]?.model,
  cores: os.cpus().length,
  ramGB: Math.round(os.totalmem() / 1024 ** 3),
  viewport: "1920x1080",
  assets: { distinctSvg: 6, distinctVideo: 1, imported: 0 },
  method: "Production build; Edge headless; 60 mouse moves with 16ms waits per sample; viewport culling on; 3 runs per size and interaction; raw rAF frame intervals retained.",
  samples: [],
  errors: [],
};
page.on("pageerror", (error) => report.errors.push(String(error)));
const saved = () => page.waitForFunction(() => {
  const state = window.frameDiagnostics?.();
  return state?.saveState === "saved" && !state.busy;
});
const focus = async () => {
  const input = page.getByRole("textbox", { name: "定位节点 ID" });
  await input.fill("3");
  await input.press("Enter");
  await page.locator('[data-node-id="node-3"]').waitFor();
  await page.waitForTimeout(500);
  await saved();
};
try {
  const url = new URL(process.env.BASE_URL ?? "http://127.0.0.1:4173");
  url.searchParams.set("workspace", `benchmark-${label}-${Date.now()}`);
  await page.goto(url.href);
  await saved();
  report.bundleUrls = await page.evaluate(() => [...document.scripts].map((script) => script.src));
  report.devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
  assert.equal(await page.evaluate(() => window.frameDiagnostics().buildMode), "production");
  for (const count of [100, 1000, 10000]) {
    await page.getByRole("button", { name: `${count} 节点数据集`, exact: true }).click();
    await page.getByRole("button", { name: "确认重新生成" }).click();
    await page.waitForFunction((n) => window.frameDiagnostics().count === n, count);
    await saved();
    for (let run = 1; run <= 3; run++) {
      for (const interaction of ["drag", "pan"]) {
        await focus();
        const target = interaction === "drag"
          ? await page.locator('[data-node-id="node-3"]').boundingBox()
          : await page.getByTestId("graph-canvas").boundingBox();
        assert(target);
        const startX = target.x + (interaction === "drag" ? target.width / 2 : 65);
        const startY = target.y + (interaction === "drag" ? target.height - 17 : 80);
        const xBefore = await page.getByTestId("position-x").innerText();
        await page.mouse.move(startX, startY);
        await page.evaluate(() => {
          const sample = window.__interactionSample = {
            running: true, frames: [], tasks: [], previous: performance.now(),
            started: performance.now(), commits: window.frameDiagnostics().appCommits,
            longTasksSupported: PerformanceObserver.supportedEntryTypes.includes("longtask"),
          };
          if (sample.longTasksSupported) {
            sample.observer = new PerformanceObserver((list) =>
              sample.tasks.push(...list.getEntries().map((entry) => entry.duration)));
            sample.observer.observe({ type: "longtask", buffered: false });
          }
          const tick = (now) => {
            if (!sample.running) return;
            sample.frames.push(now - sample.previous);
            sample.previous = now;
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        await page.mouse.down();
        for (let step = 1; step <= 60; step++) {
          await page.mouse.move(startX + step * 1.2, startY + Math.sin(step / 10) * 25);
          await page.waitForTimeout(16);
        }
        await page.mouse.up();
        const sample = await page.evaluate(() => {
          const sample = window.__interactionSample;
          sample.running = false;
          sample.observer?.disconnect();
          const diagnostics = window.frameDiagnostics();
          return {
            elapsedMs: performance.now() - sample.started,
            frameIntervalsMs: sample.frames.slice(2),
            longTasksMs: sample.tasks,
            longTasksSupported: sample.longTasksSupported,
            appCommits: diagnostics.appCommits - sample.commits,
            mountedNodes: diagnostics.renderedNodes,
            culling: diagnostics.culling,
            overview: diagnostics.overview,
          };
        });
        if (interaction === "drag") {
          assert.notEqual(await page.getByTestId("position-x").innerText(), xBefore);
        }
        assert(sample.culling && !sample.overview);
        const sorted = [...sample.frameIntervalsMs].sort((a, b) => a - b);
        assert(sorted.length > 0, "Must capture actual animation frames");
        report.samples.push({
          count, run, interaction, ...sample,
          averageFPS: sample.frameIntervalsMs.length * 1000 / sample.frameIntervalsMs.reduce((a, b) => a + b, 0),
          p95FrameMs: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
          maxLongTaskMs: sample.longTasksSupported ? Math.max(0, ...sample.longTasksMs) : null,
        });
        console.log(`${label}: ${count} nodes, ${interaction}, run ${run}, shell commits ${sample.appCommits}`);
        await saved();
      }
    }
  }
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = String(error);
  throw error;
} finally {
  const results = path.join(project, "test-results");
  await mkdir(results, { recursive: true });
  await writeFile(path.join(results, `interaction-${label}.json`), JSON.stringify(report, null, 2));
  await browser.close();
}
