import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(project, ".browser-cache");
const { chromium } = await import("@playwright/test");
const results = path.join(project, "test-results");
await mkdir(results, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  ...(process.env.RECORD_DEMO
    ? {
        recordVideo: {
          dir: path.join(results, "demo"),
          size: { width: 1440, height: 810 },
        },
      }
    : {}),
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.setDefaultTimeout(20000);
const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:4173";
const focus = async (id) => {
  await page.getByRole("textbox", { name: "定位节点 ID" }).fill(String(id));
  await page.getByRole("textbox", { name: "定位节点 ID" }).press("Enter");
  await page
    .getByTestId("selected-id")
    .filter({ hasText: `node-${id}` })
    .waitFor();
  await page.locator(`[data-node-id="node-${id}"]`).waitFor();
  await page.waitForTimeout(400);
};
const saved = () =>
  page.waitForFunction(() => window.frameDiagnostics?.().saveState === "saved");
const diagnostics = () => page.evaluate(() => window.frameDiagnostics());
const report = {
  date: new Date().toISOString(),
  browser: await browser.version(),
  platform: `${os.platform()} ${os.release()}`,
  cpu: os.cpus()[0]?.model,
  cores: os.cpus().length,
  ramGB: Math.round(os.totalmem() / 1024 ** 3),
  viewport: "1920x1080",
  assets: { originalSvg: 6, distinctVideo: 1, importedDuringTest: 1 },
  checks: [],
  initial: {},
  benchmarks: [],
  errors,
};
try {
  const testURL = new URL(baseURL);
  testURL.searchParams.set('workspace', `automation-${Date.now()}`);
  await page.goto(testURL.href);
  await page.getByTestId("node-count").filter({ hasText: "10,000" }).waitFor();
  await page.waitForFunction(() =>
    Number.isFinite(window.frameDiagnostics?.().readyMs),
  );
  report.initial = await diagnostics();
  assert.equal(report.initial.count, 10000);
  assert.equal(report.initial.edges, 9999);
  assert.equal(report.initial.players, 0);
  await page.screenshot({ path: path.join(results, "01-workspace.png") });
  report.checks.push("10,000 nodes / 9,999 edges / zero idle players");

  await page.getByRole("button", { name: "预览选中媒体" }).click();
  await page
    .getByRole("dialog", { name: "媒体预览" })
    .locator(".preview-content img")
    .waitFor();
  await page.getByRole("button", { name: "关闭预览" }).click();
  await focus(1);
  await page.getByRole("button", { name: "预览选中媒体" }).click();
  await page.locator("video").waitFor();
  await page.waitForFunction(
    () => document.querySelector("video")?.readyState >= 2,
  );
  assert.equal((await diagnostics()).players, 1);
  await page.screenshot({ path: path.join(results, "02-video-preview.png") });
  await page.getByRole("button", { name: "关闭预览" }).click();
  assert.equal((await diagnostics()).players, 0);
  report.checks.push(
    "image preview; local MP4 playback; player released on close",
  );

  await focus(3);
  const xBefore = Number(await page.getByTestId("position-x").innerText());
  const box = await page.locator('[data-node-id="node-3"]').boundingBox();
  assert(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 17);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 74,
    box.y + box.height - 17 + 46,
    { steps: 18 },
  );
  await page.mouse.up();
  await page.waitForTimeout(200);
  const xAfter = Number(await page.getByTestId("position-x").innerText());
  assert.notEqual(
    xAfter,
    xBefore,
    "Dragging must change the actual node position",
  );
  await saved();
  report.checks.push("drag updates real node position and saves incrementally");

  await page
    .getByRole("button", { name: "断开父节点连线", exact: true })
    .click();
  await page.waitForFunction(() => window.frameDiagnostics().edges === 9998);
  await focus(7000);
  await page.getByRole("textbox", { name: "连接目标节点" }).fill("3");
  await page.getByRole("button", { name: "连接子节点", exact: true }).click();
  await page.waitForFunction(() => window.frameDiagnostics().edges === 9999);
  await saved();
  await page.reload();
  await page.getByTestId("node-count").filter({ hasText: "10,000" }).waitFor();
  await focus(3);
  assert.equal(
    Number(await page.getByTestId("position-x").innerText()),
    xAfter,
  );
  await page
    .locator(".relation-row")
    .filter({ hasText: "node-7000" })
    .waitFor();
  report.checks.push(
    "detach/reconnect obeys tree rules; position and new edge survive reload",
  );

  const imageBytes = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120"><rect width="180" height="120" fill="#bd7159"/><circle cx="90" cy="60" r="35" fill="#f4e4bd"/></svg>',
  );
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "import-test.svg",
      mimeType: "image/svg+xml",
      buffer: imageBytes,
    });
  await page
    .getByRole("heading", { name: "import-test.svg", exact: true })
    .waitFor();
  await saved();
  await page.reload();
  await page.getByTestId("node-count").filter({ hasText: "10,000" }).waitFor();
  await focus(3);
  await page
    .getByRole("heading", { name: "import-test.svg", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "预览选中媒体" }).click();
  await page
    .getByRole("dialog", { name: "媒体预览" })
    .locator('img[src^="blob:"]')
    .waitFor();
  await page.getByRole("button", { name: "关闭预览" }).click();
  report.checks.push(
    "imported image Blob + generated thumbnail survives reload",
  );

  await page.getByRole("button", { name: "全图总览", exact: true }).click();
  await page.waitForFunction(
    () =>
      window.frameDiagnostics().overview &&
      document.querySelectorAll(".summary-node").length > 0,
  );
  await page.waitForTimeout(500);
  const overview = await diagnostics();
  assert.equal(overview.count, 10000);
  assert.equal(overview.edges, 9999);
  assert(overview.renderedNodes <= 255);
  await page.screenshot({ path: path.join(results, "03-overview.png") });
  await focus(9999);
  assert.equal((await diagnostics()).overview, false);
  report.checks.push(
    "overview stays under 255 mounted nodes; deep node 9999 remains accessible",
  );

  await page.getByRole("textbox", { name: "定位节点 ID" }).fill("123456");
  await page.getByRole("textbox", { name: "定位节点 ID" }).press("Enter");
  await page.getByRole("alert").filter({ hasText: "未找到该节点" }).waitFor();
  report.checks.push("invalid node search shows feedback");

  // Browser frame samples during real mouse panning, not a promise based on idle FPS.
  for (const count of [100, 1000, 10000]) {
    for (let run = 1; run <= 3; run++) {
      await page
        .getByRole("button", { name: `${count} 节点数据集`, exact: true })
        .click();
      const start = performance.now();
      await page.getByRole("button", { name: "确认重新生成" }).click();
      await page.waitForFunction(
        (expected) =>
          window.frameDiagnostics().count === expected &&
          window.frameDiagnostics().saveState === "saved",
        count,
      );
      await page.locator('[data-node-id="node-0"]').waitFor();
      await page.waitForTimeout(350);
      const resetToInteractiveMs = Math.round(performance.now() - start);
      await saved();
      await page.reload();
      await page.waitForFunction(() =>
        Number.isFinite(window.frameDiagnostics?.().readyMs),
      );
      await page.waitForTimeout(300);
      const warm = await diagnostics();
      await focus(0);
      const canvas = await page.getByTestId("graph-canvas").boundingBox();
      await page.evaluate(() => {
        window.__frameSample = {
          frames: [],
          tasks: [],
          running: true,
          previous: performance.now(),
        };
        const sample = window.__frameSample;
        try {
          sample.observer = new PerformanceObserver((list) =>
            sample.tasks.push(...list.getEntries().map((e) => e.duration)),
          );
          sample.observer.observe({ type: "longtask", buffered: false });
        } catch {}
        const loop = (now) => {
          if (!sample.running) return;
          sample.frames.push(now - sample.previous);
          sample.previous = now;
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      });
      const startX = canvas.x + 65,
        startY = canvas.y + 80;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      for (let step = 0; step < 60; step++) {
        await page.mouse.move(
          startX + Math.sin(step / 9) * 90,
          startY + Math.cos(step / 11) * 55,
        );
        await page.waitForTimeout(16);
      }
      await page.mouse.up();
      const frames = await page.evaluate(() => {
        const s = window.__frameSample;
        s.running = false;
        s.observer?.disconnect();
        return {
          frames: s.frames.slice(2),
          tasks: s.tasks,
          heapMB: performance.memory
            ? Math.round(performance.memory.usedJSHeapSize / 1024 ** 2)
            : null,
        };
      });
      frames.frames.sort((a, b) => a - b);
      const interval = frames.frames[Math.floor(frames.frames.length / 2)] ?? 0;
      report.benchmarks.push({
        count,
        run,
        resetToInteractiveMs,
        graphLoadMs: Math.round(warm.loadMs),
        warmReadyMs: Math.round(warm.readyMs),
        mountedNodes: (await diagnostics()).renderedNodes,
        medianFrameIntervalMs: Math.round(interval * 100) / 100,
        approximateMedianFPS: interval ? Math.round(1000 / interval) : 0,
        p95FrameIntervalMs:
          Math.round(
            (frames.frames[Math.floor(frames.frames.length * 0.95)] ?? 0) * 100,
          ) / 100,
        maxLongTaskMs: Math.round(Math.max(0, ...frames.tasks)),
        heapMB: frames.heapMB,
      });
    }
  }
  await focus(0);
  await saved();
  await page.screenshot({ path: path.join(results, "04-final-workspace.png") });
  assert.deepEqual(errors, [], "No uncaught browser errors");
  report.checks.push(
    "three pan measurements each for 100 / 1,000 / 10,000 nodes; no uncaught browser errors",
  );
  await writeFile(
    path.join(results, "browser-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page
    .screenshot({ path: path.join(results, "failure.png") })
    .catch(() => {});
  report.failure = String(error);
  await writeFile(
    path.join(results, "browser-report.json"),
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  await context.close();
  await browser.close();
}
