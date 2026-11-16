// node shot.mjs <outDir> <tag> <backend> "name|query;name|query" [seconds]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const repo = "C:/Users/caseyn/Downloads/BroswerMoonSweeper";
const { chromium } = await import(pathToFileURL(path.join(repo, "tools/screenshots/node_modules/@playwright/test/index.mjs")).href);
const [out, tag, backend, cellsArg, secArg] = process.argv.slice(2);
const seconds = Number(secArg ?? 5);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--ignore-gpu-blocklist", "--window-position=-32000,-32000", "--window-size=1280,720", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"] });
const rows = [];
for (const cell of cellsArg.split(";")) {
  const [name, query] = cell.split("|");
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  const t0 = Date.now();
  try {
    await page.goto(`http://localhost:5281/?${query.includes("scene=") ? "" : "scene=moon&"}solo=0&preset=medium&backend=${backend}&${query}`, { waitUntil: "load", timeout: 120000 });
    await page.waitForFunction(() => (window.__mcTerrain === undefined ? window.__mcLook !== undefined : window.__mcTerrain.info().ready === true) && (window.__mcRender?.()?.warmup?.state ?? "ready") !== "warming", undefined, { timeout: 150000 });
    await page.bringToFront();
    await page.waitForTimeout(3000);
    const r = await page.evaluate(async (ms) => {
      window.__mcStatsReset?.();
      const times = []; let last = performance.now(); const start = last;
      await new Promise((done) => { const tick = () => { const n = performance.now(); times.push(n - last); last = n; if (n - start >= ms) done(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
      times.shift(); times.sort((a, b) => a - b);
      const s = window.__mcStats?.();
      const look = window.__mcLook?.info?.();
      return { frameP50: times[Math.floor(times.length / 2)], frameP95: times[Math.floor(times.length * 0.95)], gpu: s?.gpu?.renderMs ?? null, ev: look?.ev100, key: look?.keyMode, sky: look?.skyDome, horizon: window.__mcTerrain?.info().horizon };
    }, seconds * 1000);
    await page.screenshot({ path: path.join(out, `${name}-${tag}-${backend}.png`) });
    rows.push({ name, ms: Date.now() - t0, ...r, errs: errs.slice(0, 3) });
  } catch (e) {
    rows.push({ name, error: String(e).slice(0, 300), errs: errs.slice(0, 3) });
  }
  console.log(JSON.stringify(rows.at(-1)));
  fs.writeFileSync(path.join(out, `rows-${tag}-${backend}.json`), JSON.stringify(rows, null, 1));
  await page.close();
}
fs.writeFileSync(path.join(out, `rows-${tag}-${backend}.json`), JSON.stringify(rows, null, 1));
await browser.close();
