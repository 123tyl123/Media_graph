import { readFile, readdir, writeFile } from "node:fs/promises";

const dist = new URL("../dist/", import.meta.url);
const index = await readFile(new URL("index.html", dist), "utf8");
const jsPath = index.match(/<script[^>]*src="([^"]+)"[^>]*><\/script>/)?.[1];
const cssPath = index.match(/<link[^>]*href="([^"]+\.css)"[^>]*>/)?.[1];
if (!jsPath || !cssPath) throw new Error("Cannot locate build assets");
const js = await readFile(new URL(jsPath.replace(/^\.?\//, ""), dist), "utf8");
const css = await readFile(
  new URL(cssPath.replace(/^\.?\//, ""), dist),
  "utf8",
);
const media = {};
for (const name of await readdir(new URL("media/", dist))) {
  const bytes = await readFile(new URL(`media/${name}`, dist));
  media[`/media/${name}`] =
    `data:${name.endsWith(".svg") ? "image/svg+xml" : "video/mp4"};base64,${bytes.toString("base64")}`;
}
const output = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FRAME · 媒体图谱单文件演示</title><style>${css}</style></head><body><div id="root"></div><script>window.frameAssetUrls=${JSON.stringify(media)};<\/script><script type="module">${js.replace(/<\/script/gi, "<\\/script")}<\/script></body></html>`;
await writeFile(new URL("../standalone.html", import.meta.url), output);
console.log(
  `Standalone demo created: ${(Buffer.byteLength(output) / 1024 / 1024).toFixed(2)} MB`,
);
