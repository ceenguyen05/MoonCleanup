// Capture + measure driver of the S02 / S03 look-dev scenes (M0-W3-T04). Dev tooling, not part of the app bundle.
//
//   node s02-run.mjs --scene s02|s03 --backend webgpu|webgl2 [--lane gpu|ci] [--preset medium] [--port 5186]
//                    [--variants noon,dawn] [--dbg 1] [--out <dir>] [--page /lookdev.html] [--width 1920 --height 1080]
//
// Needs a Vite dev server for apps/client that serves a page importing `s02-dev-entry.ts` (see its header), e.g. the scratch
// config used in the M0-W3-T04 report. Per variant: sets the variant through `window.__mcLookdev`, steps frames in `?capture=1`
// mode, screenshots at native resolution (DPR 1) and measures chart chips (mean Rec.709 luma of 8-bit sRGB over the chip's inner
// rectangle) and luma profiles along probe lines (berm line pair, edges) from the PNG. Writes <scene>-<backend>-<variant>.png and
// <scene>-<backend>.json. Playwright and pngjs come from tools/screenshots (no new dependency).

/* global window */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../../..");
const shots = path.join(repo, "tools/screenshots");
const { chromium } = await import(pathToFileURL(path.join(shots, "node_modules/@playwright/test/index.mjs")).href);
const { PNG } = createRequire(path.join(shots, "package.json"))("pngjs");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const sceneId = args.scene ?? "s02";
const backend = args.backend ?? "webgpu";
const lane = args.lane ?? "gpu";
const preset = args.preset ?? "medium";
const port = args.port ?? "5186";
const page_ = args.page ?? "/lookdev.html";
const dbg = args.dbg ?? "0";
const width = Number(args.width ?? 1920);
const height = Number(args.height ?? 1080);
const out = path.resolve(args.out ?? "lookdev-out");
fs.mkdirSync(out, { recursive: true });

const launch =
  lane === "ci"
    ? {
        headless: true,
        args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
      }
    : {
        headless: false,
        channel: "chrome",
        args: [
          "--enable-unsafe-webgpu",
          "--enable-features=Vulkan,WebGPU",
          "--ignore-gpu-blocklist",
          "--disable-frame-rate-limit",
        ],
      };

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function pixelLuma(png, x, y) {
  const xi = Math.min(Math.max(Math.round(x), 0), png.width - 1);
  const yi = Math.min(Math.max(Math.round(y), 0), png.height - 1);
  const i = (yi * png.width + xi) * 4;
  return luma(png.data[i], png.data[i + 1], png.data[i + 2]);
}

function bilinearLuma(png, x, y) {
  const x0 = Math.floor(x - 0.5);
  const y0 = Math.floor(y - 0.5);
  const fx = x - 0.5 - x0;
  const fy = y - 0.5 - y0;
  const a = pixelLuma(png, x0, y0) * (1 - fx) + pixelLuma(png, x0 + 1, y0) * fx;
  const b = pixelLuma(png, x0, y0 + 1) * (1 - fx) + pixelLuma(png, x0 + 1, y0 + 1) * fx;
  return a * (1 - fy) + b * fy;
}

/** Mean and spread of luma and of each channel over a rectangle. */
function rectStats(png, rect) {
  const x0 = Math.max(0, Math.round(rect.x));
  const y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(png.width, Math.round(rect.x + rect.w));
  const y1 = Math.min(png.height, Math.round(rect.y + rect.h));
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * png.width + x) * 4;
      const l = luma(png.data[i], png.data[i + 1], png.data[i + 2]);
      sum += l;
      sumSq += l * l;
      r += png.data[i];
      g += png.data[i + 1];
      b += png.data[i + 2];
      n++;
    }
  }
  if (n === 0) return { n: 0 };
  const mean = sum / n;
  return {
    n,
    luma: +mean.toFixed(1),
    std: +Math.sqrt(Math.max(sumSq / n - mean * mean, 0)).toFixed(2),
    rgb: [+(r / n).toFixed(1), +(g / n).toFixed(1), +(b / n).toFixed(1)],
  };
}

/** Luma profile along a pixel line, one sample per pixel of length. */
function lineProfile(png, line) {
  const length = Math.hypot(line.x1 - line.x0, line.y1 - line.y0);
  const n = Math.max(2, Math.ceil(length));
  const values = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    values.push(bilinearLuma(png, line.x0 + (line.x1 - line.x0) * t, line.y0 + (line.y1 - line.y0) * t));
  }
  return values;
}

/**
 * Berm line pair + edge metrics of a profile that starts on dust and ends on (or near) clean ground (or the reverse):
 * `baseline` is the dust plateau at the dusty end, `floor` the clean plateau at the other, `pair` the lit crest minus the
 * shaded trough inside the dusty part (the berm line pair), widths in pixels where the profile is more than 6 codes off the
 * baseline on each side.
 */
function profileMetrics(values) {
  // Lines start on dust and cross the clean path: baseline = dust at the start, floor = 90th percentile (the clean plateau).
  const n = values.length;
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const baseline = mean(values.slice(0, Math.max(2, Math.round(n * 0.06))));
  const sorted = [...values].sort((x, y) => x - y);
  const floor = sorted[Math.floor(n * 0.9)];
  const mid = (baseline + floor) / 2;
  const cross = values.findIndex((v) => v > mid);
  const dusty = values.slice(0, cross < 0 ? n : cross);
  const lit = Math.max(...dusty);
  const shaded = Math.min(...dusty);
  const lo = baseline + 0.1 * (floor - baseline);
  const hi = baseline + 0.9 * (floor - baseline);
  const iLo = values.findIndex((v, i) => i >= Math.max(cross - 6, 0) && v >= lo);
  const iHi = values.findIndex((v, i) => i >= Math.max(iLo, 0) && v >= hi);
  return {
    baseline: +baseline.toFixed(1),
    floor: +floor.toFixed(1),
    contrast: +(floor - baseline).toFixed(1),
    ratio: +(floor / Math.max(baseline, 1)).toFixed(3),
    litCrest: +lit.toFixed(1),
    shadedTrough: +shaded.toFixed(1),
    bermPair: +(lit - shaded).toFixed(1),
    litWidthPx: dusty.filter((v) => v - baseline > 6).length,
    shadedWidthPx: dusty.filter((v) => baseline - v > 6).length,
    edge10to90Px: iLo >= 0 && iHi >= iLo ? iHi - iLo : null,
    n,
  };
}

const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const errors = [];
const warnings = [];
const infos = [];
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" && !t.startsWith("Failed to load resource")) errors.push(t.slice(0, 700));
  else if (m.type() === "warning") warnings.push(t.slice(0, 300));
  else if (t.startsWith("[render]") || t.startsWith("[lookdev]")) infos.push(t.slice(0, 300));
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`.slice(0, 700)));

const result = {
  scene: sceneId,
  backend,
  lane,
  preset,
  dbg,
  width,
  height,
  variants: {},
  errors: [],
  warnings: [],
  infos: [],
};
const url = `http://localhost:${port}${page_}?scene=${sceneId}&backend=${backend}&preset=${preset}&capture=1&dpr=1&dbg=${dbg}${args.extra ?? ""}`;
result.url = url;
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__mcReady === true, null, { timeout: 120000 });
  const meta = await page.evaluate(() => ({
    variants: window.__mcLookdev?.variants ?? [],
    settle: window.__mcLookdev?.settleFrames ?? 6,
    err: window.__mcLookdev?.error ?? null,
    info: window.__mcInfo(),
  }));
  result.info = meta.info;
  const wanted = args.variants ? args.variants.split(",") : meta.variants;
  for (const variant of wanted) {
    await page.evaluate((v) => window.__mcLookdev.setVariant(v), variant);
    await page.evaluate((n) => window.__mcStep(n, 1 / 60), meta.settle + 58);
    await page.waitForTimeout(150);
    await page.evaluate(() => window.__mcStep(2, 1 / 60));
    const file = `${sceneId}-${backend}-${variant}${dbg !== "0" ? `-dbg${dbg}` : ""}.png`;
    const buf = await page.screenshot({ path: path.join(out, file) });
    const png = PNG.sync.read(buf);
    const probes = await page.evaluate(() => ({ ...window.__mcLookdev.probes(), error: window.__mcLookdev.error }));
    const entry = {
      file,
      size: [png.width, png.height],
      facts: probes.facts,
      error: probes.error,
      chips: {},
      lines: {},
    };
    for (const [id, rect] of Object.entries(probes.chips)) entry.chips[id] = { rect, ...rectStats(png, rect) };
    for (const [id, line] of Object.entries(probes.lines)) {
      const values = lineProfile(png, line);
      entry.lines[id] = {
        line,
        ...profileMetrics(values),
        profile: values.filter((_, i) => i % 2 === 0).map((v) => Math.round(v)),
      };
    }
    entry.drawCalls = (await page.evaluate(() => window.__mcInfo())).drawCalls;
    result.variants[variant] = entry;
    console.log(
      `${sceneId} ${backend} ${variant}: ${file} chips ${Object.entries(entry.chips)
        .map(([k, v]) => `${k}=${v.luma}`)
        .join(" ")}`,
    );
  }
} catch (e) {
  result.fatal = String(e.message).slice(0, 400);
  console.log("FATAL " + result.fatal);
}
result.errors = errors.slice(0, 12);
result.warnings = [...new Set(warnings)].slice(0, 8);
result.infos = infos.slice(0, 8);
fs.writeFileSync(
  path.join(out, `${sceneId}-${backend}${dbg !== "0" ? `-dbg${dbg}` : ""}.json`),
  JSON.stringify(result, null, 1),
);
for (const e of result.errors) console.log("ERR " + e);
for (const w of result.warnings) console.log("WARN " + w);
await browser.close();
