import { readFile, writeFile, mkdir } from "node:fs/promises";
import ts from "typescript";
import os from "node:os";
import { performance } from "node:perf_hooks";

const directory = new URL("../test-results/", import.meta.url);
await mkdir(directory, { recursive: true });
const source = await readFile(
  new URL("../src/model.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    verbatimModuleSyntax: true,
  },
}).outputText;
const compiledPath = new URL("model-benchmark-runtime.mjs", directory);
await writeFile(compiledPath, compiled);
const { generateGraph, buildTopology, buildOverview } = await import(
  compiledPath.href
);
const median = (values) =>
  values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const report = {
  measuredAt: new Date().toISOString(),
  runtime: process.version,
  cpu: os.cpus()[0]?.model,
  note: "Node.js pure data/model benchmark only. Does not measure browser rendering, IndexedDB, media decode or interaction FPS.",
  samples: [],
};
for (const count of [100, 1000, 10000]) {
  const times = [];
  let overviewNodes = 0;
  for (let run = 0; run < 11; run++) {
    const start = performance.now();
    const graph = generateGraph(count);
    const topology = buildTopology(graph.edges);
    const overview = buildOverview(graph, topology);
    overviewNodes = overview.nodes.length;
    if (run) times.push(performance.now() - start);
  }
  report.samples.push({
    count,
    edges: count - 1,
    runs: times.length,
    generationTopologyOverviewMedianMs: Number(median(times).toFixed(2)),
    overviewNodes,
  });
}
await writeFile(
  new URL("model-benchmark.json", directory),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
