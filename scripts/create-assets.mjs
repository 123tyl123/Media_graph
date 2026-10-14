import { mkdir, writeFile } from "node:fs/promises";

const palettes = [
  ["#d9e7df", "#9aaea2", "#728d78", "#3f6450", "#dbb991"],
  ["#dae8e5", "#a3c6be", "#6da69d", "#517d72", "#efdbc2"],
  ["#f1d1b6", "#c7aaa0", "#b38678", "#756f62", "#ebad78"],
  ["#dce1cd", "#a7b998", "#7c9c78", "#466a51", "#e4cb8c"],
  ["#e6d9c9", "#b4c5a6", "#819d7b", "#557557", "#e1ac8e"],
  ["#d1dfde", "#9caeb3", "#728d8a", "#375e56", "#d6c8a9"],
];
await mkdir(new URL("../public/media/", import.meta.url), { recursive: true });
for (const [i, p] of palettes.entries()) {
  const sunX = 350 + i * 27;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${p[0]}"/><stop offset="1" stop-color="${p[4]}"/></linearGradient><linearGradient id="land" x2="0" y2="1"><stop stop-color="${p[2]}"/><stop offset="1" stop-color="${p[3]}"/></linearGradient><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".58" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".09"/></feComponentTransfer><feBlend in="SourceGraphic" mode="multiply"/></filter></defs><g filter="url(#grain)"><rect width="640" height="400" fill="url(#sky)"/><circle cx="${sunX}" cy="110" r="43" fill="#fff6d4" opacity=".7"/><path d="M0 230 89 143 169 204 282 99 393 216 471 161 640 246V400H0Z" fill="${p[1]}"/><path d="M0 283 125 228 245 269 370 187 501 264 640 201V400H0Z" fill="${p[2]}" opacity=".8"/><path d="M0 310 Q145 241 291 303T640 271V400H0Z" fill="url(#land)"/><path d="M${350 + i * 5} 274 Q220 327 384 400H480Q303 329 406 269Z" fill="${p[0]}" opacity=".55"/><path d="M0 371 Q180 327 282 400H0Z" fill="${p[3]}"/><g fill="${p[3]}" opacity=".8"><path d="m52 327 12-64 13 64h-8v24H60v-24z"/><path d="m88 339 12-52 12 52h-8v20h-8v-20z"/></g><path d="m110 87 7-3 7 3m10-12 6-3 6 3" fill="none" stroke="${p[3]}" stroke-width="1.5" opacity=".3"/></g></svg>`;
  await writeFile(
    new URL(`../public/media/scene-${i}.svg`, import.meta.url),
    svg,
  );
}
console.log("Created 6 original SVG sample images.");
