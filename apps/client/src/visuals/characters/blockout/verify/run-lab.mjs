// Driver of the custodian / grains lab captures (M1-W3-T07). Not part of the app bundle. Against a running dev server:
//   node run-lab.mjs --out <dir> [--port 5291] [--backend webgpu|webgl2] [--preset medium] [--parts turntable,px32,stroke,lineup,walk]
// Headless Chrome by default (`--headless 0`: headed off-screen, for GPU timing only), 1280 x 720, DPR 1. Playwright and
// pngjs come from tools/screenshots.
//
// turntable  8 views at 45 deg, noon (sun 38) and night-near (sun -6, Earth key), custodian at 3.5 m -> tt-*.png
// px32       custodian ~32 px tall under the real light: crop + silhouette (VT-M1-18) -> px32-*.png
// stroke     Desk Duster stroke at 3.5 m, noon: grains visible within 0.5 s, luma contrast vs the same frame with
//            the grains hidden (VT-M1-16b) and the tracked x(t) (VT-M1-16) -> stroke.json, stroke-*.png
// lineup     16 player colours, day 12 m and night-near -> lineup-*.png
// walk       lope frames (bob / swing / turn) -> walk-*.png
// anim       W5-T04 animator -> CustodianAvatarView (the game's hookup): idle / walk / lope / Desk Duster scrub /
//            walking scrub / jump frame sequences, two azimuths each, plus the pose readout -> anim-*.png, anim.json

/* global window */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../../../../..");
const { chromium } = await import(
  pathToFileURL(path.join(repo, "tools/screenshots/node_modules/@playwright/test/index.mjs")).href
);
const { PNG } = await import(
  pathToFileURL(path.join(repo, "tools/screenshots/node_modules/pngjs/lib/png.js")).href
).then((m) => m.default ?? m);
const { OFFSCREEN_CHROME_ARGS } = await import(
  pathToFileURL(path.join(repo, "apps/client/src/offscreen-chrome-args.mjs")).href
);

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const port = args.port ?? "5291";
const backend = args.backend ?? "webgpu";
const preset = args.preset ?? "medium";
const parts = new Set((args.parts ?? "turntable,px32,stroke,lineup,walk,anim").split(","));
const headless = (args.headless ?? "1") !== "0";
const out = path.resolve(args.out ?? "lab-out");
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless,
  channel: "chrome",
  args: [
    ...(headless ? [] : OFFSCREEN_CHROME_ARGS),
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan,WebGPU",
    "--ignore-gpu-blocklist",
  ],
});
const report = { backend, preset, parts: [...parts], results: {}, console: [] };

async function open(query) {
  const url = `http://localhost:${port}/src/visuals/characters/blockout/verify/index.html?scene=typical&backend=${backend}&preset=${preset}&dynres=off&${query}`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") report.console.push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  // Name the URL of any failed request: the generic "404" console line carries none.
  page.on("response", (r) => {
    if (r.status() >= 400) report.console.push(`http ${r.status()}: ${r.url().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => report.console.push(`pageerror: ${String(e).slice(0, 300)}`));
  await page.goto(url, { waitUntil: "load", timeout: 120_000 });
  await page.waitForFunction(() => window.__mcLab?.ready === true, undefined, { timeout: 180_000 });
  await page.waitForTimeout(2500);
  return page;
}

async function shot(page, name) {
  const buf = await page.screenshot({ type: "png" });
  fs.writeFileSync(path.join(out, `${name}.png`), buf);
  return PNG.sync.read(buf);
}

const luma = (d, i) => d[i * 4] * 0.2126 + d[i * 4 + 1] * 0.7152 + d[i * 4 + 2] * 0.0722;

function crop(png, x0, y0, w, h, name) {
  const c = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(png.width - 1, Math.max(0, x0 + x));
      const sy = Math.min(png.height - 1, Math.max(0, y0 + y));
      const si = (sy * png.width + sx) * 4;
      const di = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) c.data[di + k] = png.data[si + k];
    }
  fs.writeFileSync(path.join(out, `${name}.png`), PNG.sync.write(c));
}

if (parts.has("turntable")) {
  const res = [];
  for (const [label, sun] of [
    ["noon", 38],
    ["night", -6],
  ]) {
    const page = await open(`sun=${sun}&lab=still&freeze=1&dist=3.2&camh=1.2&tgth=0.95&camaz=200&fov=45`);
    for (let v = 0; v < 8; v++) {
      await page.evaluate((y) => window.__mcLab.set({ yawDeg: 200 + y * 45 }), v);
      await page.waitForTimeout(500);
      const png = await shot(page, `tt-${label}-${v * 45}`);
      const box = await page.evaluate(() => window.__mcLab.heroBox());
      res.push({
        label,
        view: v * 45,
        boxPx: box,
        centerLuma: luma(
          png.data,
          Math.round((box.minY + box.maxY) / 2) * png.width + Math.round((box.minX + box.maxX) / 2),
        ),
      });
    }
    report.results[`turntable-${label}-info`] = await page.evaluate(() => ({
      look: window.__mcLook?.info?.() ?? null,
      placeholders: window.__mcLab.placeholderAssets(),
    }));
    await page.close();
  }
  report.results.turntable = res;
}

if (parts.has("px32")) {
  // Distance so the 1.85 m custodian is ~32 px tall at 720p with a 50 deg FOV: 1.85 / (2 d tan 25) * 720 = 32.
  const d = 1.85 / ((2 * Math.tan((25 * Math.PI) / 180) * 32) / 720);
  const res = [];
  for (const yaw of [200, 290, 20]) {
    const page = await open(
      `sun=38&lab=still&freeze=1&dist=${d.toFixed(2)}&camh=1.6&tgth=0.95&camaz=200&fov=50&yaw=${yaw}`,
    );
    const png = await shot(page, `px32-full-${yaw}`);
    const box = await page.evaluate(() => window.__mcLab.heroBox());
    crop(png, Math.round(box.minX) - 16, Math.round(box.minY) - 8, 64, 48, `px32-crop-${yaw}`);
    res.push({ yaw, distM: +d.toFixed(2), heightPx: +(box.maxY - box.minY).toFixed(1) });
    await page.close();
  }
  report.results.px32 = res;
}

if (parts.has("stroke")) {
  const page = await open(`sun=38&lab=still&dist=3.5&camh=2.0&tgth=0.4&camaz=150&fov=50&yaw=200`);
  await page.evaluate(() => window.__mcLab.set({ mode: "stroke", strokeTimer: 0 }));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__mcLab.set({ frozen: true }));
  await page.waitForTimeout(400);
  const a = await shot(page, "stroke-grains");
  const tracked = await page.evaluate(() => window.__mcLab.trackGrains());
  await page.evaluate(() => window.__mcLab.setGrainsVisible(false));
  await page.waitForTimeout(400);
  const b = await shot(page, "stroke-nograins");
  let visible = 0;
  let contrast = 0;
  const diffs = [];
  for (const g of tracked) {
    const x = Math.round(g.sx);
    const y = Math.round(g.sy);
    if (x < 1 || y < 1 || x >= a.width - 1 || y >= a.height - 1) continue;
    // Strongest difference in the 3 x 3 around the grain centre (the grain is >= 2 px).
    let best = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const i = (y + dy) * a.width + (x + dx);
        best = Math.max(best, Math.abs(luma(a.data, i) - luma(b.data, i)));
      }
    if (best >= 2) visible++;
    if (best >= 15) contrast++;
    diffs.push(+best.toFixed(1));
  }
  const tip = await page.evaluate(() => window.__mcLab.toolTip());
  report.results.stroke = {
    grainsTracked: tracked.length,
    grainsVisible: visible,
    grainsContrast15: contrast,
    contrastShare: visible === 0 ? 0 : +(contrast / visible).toFixed(3),
    diffs,
    grains: await page.evaluate(() => window.__mcLab.grains()),
    toolTipPx: tip,
  };
  const xs = tracked.map((g) => g.sx);
  const ys = tracked.map((g) => g.sy);
  if (xs.length > 0) {
    const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
    const cy = Math.round((Math.min(...ys) + Math.max(...ys)) / 2);
    crop(a, cx - 160, cy - 120, 320, 240, "stroke-grains-crop");
    crop(b, cx - 160, cy - 120, 320, 240, "stroke-nograins-crop");
  }
  // Animated sequence for a GIF / motion check: 12 frames 80 ms apart.
  await page.evaluate(() => {
    window.__mcLab.setGrainsVisible(true);
    window.__mcLab.set({ frozen: false });
  });
  for (let k = 0; k < 12; k++) {
    await page.waitForTimeout(80);
    await shot(page, `stroke-seq-${String(k).padStart(2, "0")}`);
  }
  await page.close();
}

if (parts.has("lineup")) {
  for (const [label, sun] of [
    ["day", 38],
    ["night", -6],
  ]) {
    const page = await open(`sun=${sun}&lab=lineup&freeze=1&dist=12&camh=1.8&tgth=1.0&camaz=180&fov=60&yaw=180`);
    await shot(page, `lineup-${label}`);
    await page.close();
  }
}

if (parts.has("walk")) {
  const page = await open(`sun=38&lab=walk&dist=4.5&camh=1.8&tgth=0.9&camaz=150&fov=50&speed=2.2`);
  for (let k = 0; k < 8; k++) {
    await page.waitForTimeout(120);
    await shot(page, `walk-${k}`);
  }
  report.results.walkInfo = await page.evaluate(() => window.__mcInfo?.() ?? null);
  await page.close();
}

if (parts.has("anim")) {
  const res = {};
  const acts = (args.acts ?? "idle,walk,lope,sweep,sweepwalk,jump").split(",");
  for (const act of acts) {
    for (const az of (args.az ?? "120,200").split(",").map(Number)) {
      // Other writers' edits make the dev server full-reload open pages: retry the strip (up to 4 attempts).
      let frames = null;
      for (let attempt = 0; attempt < 4 && frames === null; attempt++) {
        let page = null;
        try {
          page = await open(`sun=38&lab=anim&freeze=1&act=${act}&dist=3.6&camh=1.5&tgth=0.7&camaz=${az}&fov=50&yaw=200`);
          // Deterministic sequence: freeze, settle 1.5 s of fixed 1/60 steps (kneel-down, gait sync), then one capture per
          // `stepN` fixed steps (sweep / walk 4 = 67 ms, i.e. a 15 fps strip; jump 10 = 167 ms across the 2.7 s hop).
          const stepN = act === "jump" ? 10 : 4;
          await page.evaluate(() => window.__mcLab.set({ frozen: true, actT: 0 }));
          await page.evaluate((n) => (window.__mcLab.state.pending = n), act === "jump" ? 6 : 90);
          await page.waitForTimeout(300);
          const strip = [];
          for (let k = 0; k < 12; k++) {
            await shot(page, `anim-${act}-az${az}-${String(k).padStart(2, "0")}`);
            strip.push(await page.evaluate(() => window.__mcLab.anim()));
            await page.evaluate((n) => (window.__mcLab.state.pending = n), stepN);
            await page.waitForTimeout(200);
          }
          await page.close();
          frames = strip;
        } catch (e) {
          report.console.push(`anim ${act} az${az} attempt ${attempt}: ${String(e).slice(0, 160)}`);
          frames = null;
          await page?.close().catch(() => undefined);
        }
      }
      res[`${act}-az${az}`] = frames;
    }
  }
  report.results.anim = res;
  fs.writeFileSync(path.join(out, "anim.json"), JSON.stringify(res, null, 1));
}

fs.writeFileSync(path.join(out, `lab-${backend}.json`), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      ...report,
      results: {
        ...report.results,
        stroke: report.results.stroke ? { ...report.results.stroke, diffs: undefined } : undefined,
      },
    },
    null,
    1,
  ).slice(0, 4000),
);
await browser.close();
