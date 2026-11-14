// node dynres-demo.mjs <out.json> "<query>" <seconds> [forceCeilAtS] [unthrottled]
// Real app, no capture mode, vsync on by default. Applies the typical walk path, then logs the controller every 0.5 s.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const repo = "C:/Users/caseyn/Downloads/BroswerMoonSweeper";
const { chromium } = await import(pathToFileURL(path.join(repo, "tools/perf/node_modules/@playwright/test/index.mjs")).href);
const [out, query, seconds = "60", forceAt = "", unthrottled = ""] = process.argv.slice(2);
const args = ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--ignore-gpu-blocklist"];
if (unthrottled === "unthrottled") args.push("--disable-frame-rate-limit");
const browser = await chromium.launch({ headless: false, channel: "chrome", args });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
await page.goto(`http://localhost:5180/?${query}&perf=1`);
await page.waitForFunction(() => window.__mcReady === true, null, { timeout: 120000 });
const walk = JSON.parse(fs.readFileSync(path.join(repo, "docs/agent-reports/M0-W3-T08-evidence/typical-walk.json"), "utf8"));
await page.evaluate((spec) => {
  window.__mcCameraPath?.(spec);
  const rec = { buf: [], prev: performance.now() };
  window.__rec = rec;
  const tick = (t) => { rec.buf.push(t - rec.prev); rec.prev = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}, walk);
const rows = [];
const t0 = await page.evaluate(() => performance.now());
const total = Number(seconds) * 2;
const forceTick = forceAt === "" ? -1 : Math.round(Number(forceAt) * 2);
for (let i = 0; i < total; i++) {
  await page.waitForTimeout(500);
  if (i === forceTick) await page.evaluate(() => window.__mcRenderScale(1));
  const row = await page.evaluate(() => {
    const d = window.__mcDynres();
    const buf = window.__rec.buf.splice(0).sort((a, b) => a - b);
    const q = (p) => (buf.length === 0 ? 0 : buf[Math.min(buf.length - 1, Math.floor(p * buf.length))]);
    return { at: performance.now(), scale: d.scale, p90: +d.p90Ms.toFixed(1), target: +d.targetMs.toFixed(1), signal: d.signal, steps: d.steps,
      floorHint: d.floorHint, enabled: d.enabled, pinned: d.pinned, frames: buf.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1) };
  });
  rows.push({ t: +((row.at - t0) / 1000).toFixed(1), ...row, forced: i === forceTick });
}
const info = await page.evaluate(() => window.__mcInfo());
await browser.close();
fs.writeFileSync(out, JSON.stringify({ query, seconds: Number(seconds), unthrottled: unthrottled === "unthrottled", info, errors, rows }, null, 1));
let last = null; const trace = [];
for (const r of rows) { if (r.scale !== last) { trace.push(`${r.t}s:${r.scale}${r.forced ? "(forced)" : ""}`); last = r.scale; } }
const tail = rows.slice(-20); const med = (k) => tail.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(tail.length / 2)];
console.log(path.basename(out), info.backend, info.preset, "trace", trace.join(" -> "), "| last10s frame p50", med("p50"), "p95", med("p95"), "| steps", rows.at(-1).steps, "| errors", errors.length);
