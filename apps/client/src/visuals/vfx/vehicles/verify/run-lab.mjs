// Driver of the Trundle lab captures (M1-W7-T02, VT-M1-35). Not part of the app bundle. Against a running dev server:
//   node run-lab.mjs --out <dir> [--port 5291] [--backend webgpu|webgl2] [--preset medium] [--model glb|procedural]
//                    [--parts turntable,spray] [--headless 1|0]
// turntable  8 views at 45 deg, noon (sun 38) and night-near (sun -6, lamps on) at 1280 x 720 -> tt-*.png
// spray      front and side views, night, lamps on, drum running (speed 2.5, work 1), grains live -> spray-*.png
// Headless Chrome by default (`--headless 0`: headed off-screen for real-GPU captures). Playwright from tools/screenshots.

/* global window */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../../../../..");
const { chromium } = await import(
  pathToFileURL(path.join(repo, "tools/screenshots/node_modules/@playwright/test/index.mjs")).href
);
const { OFFSCREEN_CHROME_ARGS } = await import(
  pathToFileURL(path.join(repo, "apps/client/src/offscreen-chrome-args.mjs")).href
);

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const port = args.port ?? "5291";
const backend = args.backend ?? "webgpu";
const preset = args.preset ?? "medium";
const model = args.model ?? "glb";
const parts = new Set((args.parts ?? "turntable,spray").split(","));
const headless = (args.headless ?? "1") !== "0";
const out = path.resolve(args.out ?? "trundle-lab-out");
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
const report = { backend, preset, model, results: {}, console: [] };

async function open(query) {
  const url = `http://localhost:${port}/src/visuals/vfx/vehicles/verify/index.html?scene=typical&backend=${backend}&preset=${preset}&dynres=off&model=${model}&${query}`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") report.console.push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => report.console.push(`pageerror: ${String(e).slice(0, 300)}`));
  await page.goto(url, { waitUntil: "load", timeout: 120_000 });
  await page.waitForFunction(() => window.__mcTrundle?.ready === true, undefined, { timeout: 180_000 });
  await page.waitForTimeout(2500);
  return page;
}

async function shot(page, name) {
  fs.writeFileSync(path.join(out, `${name}.png`), await page.screenshot({ type: "png" }));
}

if (parts.has("turntable")) {
  for (const [label, sun, lights] of [
    ["noon", 38, false],
    ["night", -6, true],
  ]) {
    const page = await open(`sun=${sun}&dist=3.4&camh=1.1&tgth=0.5&fov=45&lights=${lights ? 1 : 0}`);
    for (let v = 0; v < 8; v++) {
      await page.evaluate((a) => window.__mcTrundle.set({ camAzDeg: a }), v * 45);
      await page.waitForTimeout(600);
      await shot(page, `tt-${label}-${v * 45}`);
    }
    report.results[`turntable-${label}`] = await page.evaluate(() => window.__mcTrundle.info());
    await page.close();
  }
}

if (parts.has("spray")) {
  // camaz 0 = looking at the drum end from the front (+Z), 90 = side (+X).
  const views = [
    ["front", 20, 2.6, 1.0, 0.35],
    ["side", 90, 2.8, 0.8, 0.35],
  ];
  for (const [label, az, dist, camh, tgth] of views) {
    const page = await open(
      `sun=-6&dist=${dist}&camh=${camh}&tgth=${tgth}&fov=45&lights=1&speed=2.5&work=1&camaz=${az}`,
    );
    await page.waitForTimeout(1500);
    await shot(page, `spray-${label}`);
    report.results[`spray-${label}`] = await page.evaluate(() => window.__mcTrundle.info());
    await page.close();
  }
}

fs.writeFileSync(path.join(out, `lab-${backend}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1).slice(0, 3000));
await browser.close();
