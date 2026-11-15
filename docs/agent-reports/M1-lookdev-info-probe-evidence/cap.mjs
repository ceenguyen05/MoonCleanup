// S05 probe capture: node cap.mjs --base http://127.0.0.1:5194/ --out <dir> --tag before --presets low,medium
//   [--views wide,slope,shadeSlope] [--backend webgpu] [--extra "k=v&k=v"] [--scene s05] [--query "sun=60&az=200"]
// Writes <tag>-<scene>-<view>-<preset>-<backend>.png (native 1920x1080 @1), the same with probe boxes drawn (-marked.png)
// and one JSON with info(), probes and 48 px / 16 px patch measures of every visible probe.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = "C:/Users/caseyn/Downloads/BroswerMoonSweeper";
const mod = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { chromium } = await mod("tools/screenshots/node_modules/@playwright/test/index.mjs");
const pngjs = await mod("tools/screenshots/node_modules/pngjs/lib/png.js");
const PNG = pngjs.PNG ?? pngjs.default?.PNG;

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[++i];
const base = args.base ?? "http://127.0.0.1:5194/";
const out = path.resolve(args.out ?? "out");
fs.mkdirSync(out, { recursive: true });
const tag = args.tag ?? "cap";
const backend = args.backend ?? "webgpu";
const scene = args.scene ?? "s05";
const query = args.query ?? "sun=60&az=200";
const presets = (args.presets ?? "low,medium").split(",");
const views = (args.views ?? "wide,slope,shadeSlope").split(",");

const browser = await chromium.launch({
  headless: false,
  channel: "chrome",
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--ignore-gpu-blocklist"],
});
const results = [];
function box(png, cx, cy, half, rgb) {
  const put = (x, y) => {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
    const i = (y * png.width + x) * 4;
    png.data[i] = rgb[0];
    png.data[i + 1] = rgb[1];
    png.data[i + 2] = rgb[2];
    png.data[i + 3] = 255;
  };
  for (let t = -half; t <= half; t++) {
    for (const w of [0, 1]) {
      put(Math.round(cx + t), Math.round(cy - half - w));
      put(Math.round(cx + t), Math.round(cy + half + w));
      put(Math.round(cx - half - w), Math.round(cy + t));
      put(Math.round(cx + half + w), Math.round(cy + t));
    }
  }
}
const COLOURS = { slopeShadow: [255, 0, 0], rampShadow: [255, 0, 255], slopeLit: [0, 200, 0], flatShadow: [0, 120, 255], flatLit: [255, 200, 0], slopeBoots: [0, 220, 220], wallShadow: [140, 0, 255], wallLit: [255, 120, 0] };
try {
  for (const preset of presets) {
    for (const view of views) {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      const errors = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)));
      page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message).slice(0, 300)));
      const url = `${base}?scene=${scene}&${query}&preset=${preset}&backend=${backend}&view=${view}&hud=0&scale=floor${args.extra ? "&" + args.extra : ""}&capture=1`;
      await page.goto(url);
      await page.waitForFunction(() => window.__mcReady === true, null, { timeout: 240000 });
      await page.evaluate(() => window.__mcStep(30, 1 / 60));
      await page.waitForTimeout(300);
      await page.evaluate(() => window.__mcStep(2, 1 / 60));
      const name = `${tag}-${scene}-${view}-${preset}-${backend}`;
      const buf = await page.screenshot({ path: path.join(out, `${name}.png`) });
      const meta = await page.evaluate(() => ({ look: window.__mcLook?.info?.() ?? null, mc: window.__mcInfo?.() ?? null, probes: window.__mcLook?.probes?.() ?? {} }));
      const names = Object.keys(meta.probes).filter((n) => meta.probes[n].px.visible);
      const rects = (half) => names.map((n) => ({ x: meta.probes[n].px.x - half, y: meta.probes[n].px.y - half, w: half * 2, h: half * 2 }));
      const dataUrl = `data:image/png;base64,${buf.toString("base64")}`;
      const [s48, s16] = await page.evaluate(async ([u, a, b]) => [await window.__mcLook.measure(u, a), await window.__mcLook.measure(u, b)], [dataUrl, rects(24), rects(8)]);
      const probes = {};
      names.forEach((n, i) => {
        probes[n] = {
          world: meta.probes[n].world.map((v) => +Number(v).toFixed(3)),
          px: [Math.round(meta.probes[n].px.x), Math.round(meta.probes[n].px.y)],
          luma48: +s48[i].luma.toFixed(1),
          luma16: +s16[i].luma.toFixed(1),
          labB16: +s16[i].labB.toFixed(2),
        };
      });
      const hidden = Object.keys(meta.probes).filter((n) => !meta.probes[n].px.visible);
      const png = PNG.sync.read(buf);
      for (const n of names) box(png, meta.probes[n].px.x, meta.probes[n].px.y, 24, COLOURS[n] ?? [255, 255, 255]);
      fs.writeFileSync(path.join(out, `${name}-marked.png`), PNG.sync.write(png));
      const look = meta.look ?? {};
      const row = {
        name,
        url,
        size: [png.width, png.height],
        preset: look.preset,
        backend: look.backend,
        renderScale: meta.mc?.renderScale ?? null,
        sun: look.state ? [look.state.sunElevationDeg, look.state.sunAzimuthDeg] : null,
        shadowMapSize: look.shadowMapSize ?? "not reported",
        adaptationMultiplier: look.adaptationMultiplier ?? "not reported",
        notBuilt: look.notBuilt ?? "not reported",
        dustAtlas: look.dustAtlas ?? null,
        cascades: look.cascades,
        shadowFilter: look.shadowFilter,
        probes,
        hiddenProbes: hidden,
        errors,
      };
      results.push(row);
      console.log(name, JSON.stringify({ shadowMapSize: row.shadowMapSize, renderScale: row.renderScale, probes, hidden, errors: errors.length }));
      await page.close();
    }
  }
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(out, `${tag}-${scene}-${backend}.json`), JSON.stringify(results, null, 1));
