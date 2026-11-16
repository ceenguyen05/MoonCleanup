// Long-run JS heap soak. Samples CDP Runtime.getHeapUsage every SAMPLE_S, forced GC (HeapProfiler.collectGarbage) at
// start, mid and end, counts long frames (rAF delta) and longtasks in-page. Writes JSON next to --out.
//   MC_BASE=http://127.0.0.1:5220/ node heap-soak.mjs --minutes 10 --query "scene=typical&solo=1&perf=1&preset=low" --out file.json
/* global window, requestAnimationFrame */
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { OFFSCREEN_CHROME_ARGS } from "./offscreen-chrome-args.mjs";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const BASE = process.env.MC_BASE ?? "http://127.0.0.1:5220/";
const minutes = Number(arg("minutes", "10"));
const query = arg("query", "scene=typical&solo=1&perf=1&preset=low");
const out = arg("out", "heap-soak.json");
const SAMPLE_S = 5;

const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: [
    ...OFFSCREEN_CHROME_ARGS,
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan,WebGPU",
    "--ignore-gpu-blocklist",
    "--force_high_performance_gpu",
    "--enable-precise-memory-info",
  ],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.addInitScript("globalThis.__name = globalThis.__name || function (f) { return f; };");
const warn = [];
page.on(
  "console",
  (m) => (m.type() === "warning" || m.type() === "error") && warn.length < 20 && warn.push(m.text().slice(0, 200)),
);
page.on("pageerror", (e) => warn.length < 20 && warn.push("pageerror: " + String(e).slice(0, 200)));
const cdp = await page.context().newCDPSession(page);
await cdp.send("Runtime.enable");
await cdp.send("HeapProfiler.enable");
await page.goto(`${BASE}?${query}`, { waitUntil: "commit", timeout: 180000 });
await page.waitForFunction(() => window.__mcReady === true, null, { timeout: 240000 });
await page.waitForTimeout(3000);
await page.evaluate(() => {
  const s = { n: 0, long50: 0, long33: 0, max: 0, tasks: 0, taskMax: 0, taskOver50: 0 };
  window.__soak = s;
  let prev = performance.now();
  const tick = (t) => {
    const d = t - prev;
    prev = t;
    s.n++;
    if (d > 50) s.long50++;
    if (d > 33.4) s.long33++;
    if (d > s.max) s.max = d;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        s.tasks++;
        if (e.duration > s.taskMax) s.taskMax = e.duration;
        if (e.duration > 50) s.taskOver50++;
      }
    }).observe({ entryTypes: ["longtask"] });
  } catch {
    // longtask observer unsupported: counts stay zero
  }
});
const info = await page.evaluate(async () => {
  const a = await navigator.gpu?.requestAdapter();
  return {
    ua: navigator.userAgent,
    gpu: a ? `${a.info?.vendor} ${a.info?.architecture} ${a.info?.description ?? ""}` : "none",
    stats: window.__mcStats?.() ?? null,
  };
});
const heap = async () => (await cdp.send("Runtime.getHeapUsage")).usedSize;
const samples = [];
const t0 = Date.now();
async function sample(kind) {
  const usedBytes = await heap();
  const s = await page.evaluate(() => ({ ...window.__soak, st: window.__mcStats?.() ?? null }));
  samples.push({
    tS: (Date.now() - t0) / 1000,
    kind,
    usedBytes,
    frames: s.n,
    long50: s.long50,
    long33: s.long33,
    maxFrameMs: s.max,
    longtasks: s.tasks,
    taskMaxMs: s.taskMax,
    taskOver50: s.taskOver50,
    hudHeap: s.st?.memory?.jsHeapBytes ?? null,
    fps: s.st?.fps ?? null,
    draws: s.st?.draws ?? s.st?.render?.drawCalls ?? null,
  });
}
async function gc(kind) {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  await sample(kind);
}
await gc("gc-start");
const total = minutes * 60;
let gcMid = false;
for (let t = SAMPLE_S; t <= total; t += SAMPLE_S) {
  await page.waitForTimeout(Math.max(0, t0 + t * 1000 - Date.now()));
  if (!gcMid && t >= total / 2) {
    gcMid = true;
    await gc("gc-mid");
  } else await sample("sample");
  if (t % 60 === 0) console.log(`[soak] ${t}s heap=${(samples.at(-1).usedBytes / 1048576).toFixed(1)}MB`);
}
await gc("gc-end");
writeFileSync(out, JSON.stringify({ query, minutes, info, warnings: warn, samples }, null, 1));
await browser.close();
console.log("done", out);
