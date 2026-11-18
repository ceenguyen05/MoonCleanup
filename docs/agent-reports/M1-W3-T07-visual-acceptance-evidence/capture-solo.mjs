// Real Solo scrub capture (M1-W3-T07 visual acceptance). Headless Chrome, real GPU, WebGPU Medium, 1280x720 DPR1.
//   node capture-solo.mjs --out <dir> [--port 5311] [--query ""] [--backend webgpu]
// Default boot (no ?scene=). Holds Mouse0 (toolPrimary) after pointer lock, optionally with W, and screenshots on a timer.
/* global window, document */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const { chromium } = await import(
  pathToFileURL(path.join(repo, "tools/screenshots/node_modules/@playwright/test/index.mjs")).href
);
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const port = args.port ?? "5311";
const out = path.resolve(args.out ?? "solo-out");
const query = args.query ?? "";
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--ignore-gpu-blocklist"],
});
const log = { console: [], snaps: {} };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") log.console.push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) log.console.push(`http ${r.status()}: ${r.url().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => log.console.push(`pageerror: ${String(e).slice(0, 300)}`));
  await page.goto(`http://localhost:${port}/${query}`, { waitUntil: "load", timeout: 120_000 });
  await page.waitForFunction(() => window.__mcReady === true, undefined, { timeout: 240_000 });
  await page.waitForFunction(() => window.__mcGameplay?.()?.predicted === true, undefined, { timeout: 120_000 });
  await page.waitForTimeout(6000);
  const snap = () => page.evaluate(() => window.__mcGameplay());
  const info = () =>
    page.evaluate(() => {
      const i = typeof window.__mcInfo === "function" ? window.__mcInfo() : window.__mcInfo;
      return i ? { backend: i.backend, gpu: i.gpu, ft: i.frameTimeAvgMs, p95: i.frameTimeP95Ms, dpr: i.dpr } : null;
    });
  log.info = await info();
  log.snaps.start = await snap();
  // pointer lock
  await page.mouse.move(640, 360);
  await page.mouse.click(640, 360);
  await page.waitForTimeout(800);
  await page.keyboard.press("KeyV"); // first -> third person camera
  await page.waitForTimeout(1500);
  log.pointerLocked = await page.evaluate(() => document.pointerLockElement !== null);
  log.snaps.afterClick = await snap();

  let n = 0;
  const shot = async (tag) => {
    const name = `${tag}-${String(n++).padStart(2, "0")}.png`;
    await page.screenshot({ path: path.join(out, name), type: "png" });
    return name;
  };
  const series = [];
  const run = async (tag, count, gapMs) => {
    for (let k = 0; k < count; k++) {
      const name = await shot(tag);
      series.push({ name, t: Date.now(), snap: await snap(), info: await info() });
      await page.waitForTimeout(gapMs);
    }
  };

  await run("idle", 2, 200);
  // Stationary scrub
  await page.mouse.down({ button: "left" });
  await page.waitForTimeout(700);
  await run("scrub", 10, 150);
  log.snaps.midScrub = await snap();
  await page.mouse.up({ button: "left" });
  await run("scrub-end", 6, 120);
  // Walking scrub
  await page.keyboard.down("KeyW");
  await page.mouse.down({ button: "left" });
  await page.waitForTimeout(500);
  await run("walkscrub", 10, 120);
  await page.mouse.up({ button: "left" });
  await page.keyboard.up("KeyW");
  await run("walkscrub-end", 4, 120);
  log.snaps.end = await snap();
  log.series = series;
} catch (e) {
  log.error = String(e);
} finally {
  fs.writeFileSync(path.join(out, "solo.json"), JSON.stringify(log, null, 1));
  await browser.close();
}
console.log(JSON.stringify({ error: log.error, pointerLocked: log.pointerLocked, info: log.info, console: log.console.slice(0, 20) }, null, 1));
