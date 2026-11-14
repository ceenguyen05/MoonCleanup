// node shot.mjs <out.png> "<query>" [width] [height]
// Loads the real app in capture mode, steps frames, screenshots, measures look probes (S02 chips / __mcLook probes).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const repo = "C:/Users/caseyn/Downloads/BroswerMoonSweeper";
const { chromium } = await import(
  pathToFileURL(path.join(repo, "tools/perf/node_modules/@playwright/test/index.mjs")).href
);
const [out, query, w = "1920", h = "1080"] = process.argv.slice(2);
const browser = await chromium.launch({
  headless: false,
  channel: "chrome",
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
  if (m.type() === "warning" && !/preloaded/.test(m.text())) errors.push("warn: " + m.text());
});
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
await page.goto(`http://localhost:5180/?${query}&capture=1&hud=0`);
await page.waitForFunction(() => window.__mcReady === true, null, { timeout: 120000 });
await page.evaluate(() => window.__mcStep(40, 1 / 60));
await page.waitForTimeout(400);
await page.evaluate(() => window.__mcStep(4, 1 / 60));
// Hide DOM overlays so the screenshot is the canvas only.
await page.addStyleTag({ content: "#mc-overlay,#mc-perf-hud,[data-mc-ui]{display:none !important}" });
const buf = await page.screenshot({ path: out });
const dataUrl = `data:image/png;base64,${buf.toString("base64")}`;
const result = await page.evaluate(async (u) => {
  const res = { info: null, look: {}, chips: {}, facts: null, grid: [] };
  const look = window.__mcLook;
  if (look) {
    // 12 x 6 grid of 60 px blocks over the whole frame: mean luma + rgb per block, for before/after diffs.
    const W = window.innerWidth, H = window.innerHeight, rects = [];
    for (let j = 0; j < 6; j++) for (let i = 0; i < 12; i++) rects.push({ x: Math.round(((i + 0.5) * W) / 12 - 30), y: Math.round(((j + 0.5) * H) / 6 - 30), w: 60, h: 60 });
    const g = await look.measure(u, rects);
    res.grid = g.map((p) => [+p.luma.toFixed(2), +p.r.toFixed(1), +p.g.toFixed(1), +p.b.toFixed(1)]);
    res.info = look.info();
    const probes = look.probes();
    const names = Object.keys(probes).filter((n) => probes[n].px.visible);
    const stats = await look.measure(
      u,
      names.map((n) => ({ x: probes[n].px.x - 8, y: probes[n].px.y - 8, w: 16, h: 16 })),
    );
    names.forEach((n, i) => (res.look[n] = +stats[i].luma.toFixed(1)));
    const dev = window.__mcLookdev;
    if (dev) {
      const p = dev.probes();
      const ids = Object.keys(p.chips);
      const cs = await look.measure(
        u,
        ids.map((id) => p.chips[id]),
      );
      ids.forEach((id, i) => (res.chips[id] = +cs[i].luma.toFixed(1)));
      res.facts = p.facts;
    }
  }
  return res;
}, dataUrl);
await browser.close();
const info = result.info;
console.log(
  path.basename(out),
  JSON.stringify({
    preset: info?.preset,
    backend: info?.backend,
    passes: info?.postPasses,
    knobs: info?.knobs,
    skyDome: info?.skyDome,
    filter: info?.shadowFilter,
    look: result.look,
    chips: result.chips,
    errors,
  }),
);
fs.writeFileSync(out.replace(/\.png$/, ".json"), JSON.stringify({ query, ...result, errors }, null, 1));
