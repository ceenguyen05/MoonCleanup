// GPU timestamp-query cost A/B on a PRODUCTION build (M0 perf rerun, performance-profiler).
//   MC_BASE=http://localhost:4183/ node gpu-timing-ab.mjs --out <dir> [--rounds 3] [--warm 8] [--windows 5] [--scale 0.75]
//        [--query "scene=typical&preset=low&backend=webgpu"]
// Variants (production: no debug module, no __mcStats):
//   on   default URL        -> dynres steers, trackTimestamp + GpuTimingModule (resolve every 16 frames)
//   off  `&dynres=off`       -> no timestamp queries, no GpuTimingModule (the scale setter still works)
// Both pages are set to the same render scale with `__mcRenderScale` after ready (the dynres controller of `on` may move it
// later; the final scale and signal are recorded). Measured per page, after the warm-up:
//   - the app's own frame intervals: `__mcInfo()` avg / p95 of its last 240 intervals, polled every 5 s (`--windows` polls)
//   - main-thread CPU: CDP Performance.getMetrics ScriptDuration / TaskDuration deltas, per second and per frame
//   - allocation: CDP sampling heap profiler with objects collected by minor and major GC included (allocation volume,
//     sampled), bytes per second and per frame, plus the top self-size frames
// Pages run in rotated order (on/off, off/on, ...). Uses the Playwright build of tools/screenshots like the visual drivers.
// Options added for the idle rerun (M0-perf-idle-rerun):
//   --hold 1    re-pin `__mcRenderScale(scale)` at the start of every rAF in BOTH variants, so the `on` controller cannot
//               move the scale for more than one frame; frames that started at another scale are counted (`offScaleFrames`)
//   --vsync 1   launch without `--disable-frame-rate-limit --disable-gpu-vsync` (the production condition)
//   --heap 0    skip the sampling heap profiler (it costs main-thread CPU in both variants)
//   rAF frame intervals are recorded into a preallocated buffer: p50 / p95 / p99 per page.
/* global window, requestAnimationFrame -- browser globals, used only inside page.evaluate callbacks */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = "C:/Users/caseyn/Downloads/BroswerMoonSweeper";
const { chromium } = await import(
  pathToFileURL(path.join(REPO, "tools/screenshots/node_modules/@playwright/test/index.mjs")).href
);
const args = {};
for (let i = 2; i < process.argv.length; i++)
  if (process.argv[i].startsWith("--")) args[process.argv[i].slice(2)] = process.argv[++i];
const BASE = process.env.MC_BASE ?? "http://localhost:4183/";
const out = path.resolve(args.out ?? "out-gpu-timing");
fs.mkdirSync(out, { recursive: true });
const rounds = Number(args.rounds ?? 3);
const warm = Number(args.warm ?? 8);
const windows = Number(args.windows ?? 5);
const scale = Number(args.scale ?? 0.75);
const query = args.query ?? "scene=typical&preset=low&backend=webgpu";
const hold = args.hold === "1";
const vsync = args.vsync === "1";
const heap = args.heap !== "0";
const variants = [
  { name: "on", query },
  { name: "off", query: `${query}&dynres=off` },
];

const browser = await chromium.launch({
  headless: false,
  channel: "chrome",
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan,WebGPU",
    "--ignore-gpu-blocklist",
    ...(vsync ? [] : ["--disable-frame-rate-limit", "--disable-gpu-vsync"]),
  ],
});
const pct = (a, q) => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  return s.length === 0 ? NaN : s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const metric = (m, name) => m.metrics.find((x) => x.name === name)?.value ?? NaN;
const median = (a) => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  return s.length === 0 ? NaN : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const r2 = (v) => (Number.isFinite(v) ? Number(v.toFixed(3)) : null);

const rows = [];
for (let round = 0; round < rounds; round++) {
  const order = round % 2 === 0 ? variants : [...variants].reverse();
  for (const v of order) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)));
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 300)));
    await page.goto(`${BASE}?${v.query}`);
    await page.waitForFunction(() => window.__mcReady === true, null, { timeout: 240000 });
    const appliedScale = await page.evaluate((s) => window.__mcRenderScale(s), scale);
    if (hold) {
      // Same work in both variants: one setter call per rAF (a no-op when the scale is unchanged).
      await page.evaluate((s) => {
        const h = (window.__abHold = { off: 0, n: 0, on: true });
        const tick = () => {
          if (!h.on) return;
          h.n++;
          if (window.__mcInfo().renderScale !== s) {
            h.off++;
            window.__mcRenderScale(s);
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, scale);
    }
    await page.waitForTimeout(warm * 1000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    if (heap) {
      await cdp.send("HeapProfiler.enable");
      await cdp.send("HeapProfiler.collectGarbage");
      await cdp.send("HeapProfiler.startSampling", {
        samplingInterval: 8192,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
      });
    }
    await page.evaluate(
      (cap) => {
        if (window.__abHold) {
          window.__abHold.off = 0;
          window.__abHold.n = 0;
        }
        const rec = (window.__abRaf = { buf: new Float64Array(cap), n: 0, on: true, prev: performance.now() });
        const tick = (t) => {
          if (!rec.on) return;
          if (rec.n < rec.buf.length) rec.buf[rec.n++] = t - rec.prev;
          rec.prev = t;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      Math.ceil(windows * 5 * 400),
    );
    const m0 = await cdp.send("Performance.getMetrics");
    const t0 = Date.now();
    const polls = [];
    for (let w = 0; w < windows; w++) {
      await page.waitForTimeout(5000);
      polls.push(
        await page.evaluate(() => {
          const i = window.__mcInfo();
          return {
            avg: i.frameTimeAvgMs,
            p95: i.frameTimeP95Ms,
            scale: i.renderScale,
            draws: i.drawCalls,
            tris: i.triangles,
          };
        }),
      );
    }
    const m1 = await cdp.send("Performance.getMetrics");
    const seconds = (Date.now() - t0) / 1000;
    const rafOut = await page.evaluate(() => {
      const rec = window.__abRaf;
      rec.on = false;
      const h = window.__abHold;
      if (h) h.on = false;
      return { d: Array.from(rec.buf.subarray(1, rec.n)), off: h ? h.off : null, n: h ? h.n : null };
    });
    let sampled = NaN;
    let top = [];
    if (heap) {
      const { profile } = await cdp.send("HeapProfiler.stopSampling");
      // Sampled allocation volume: sum of sample sizes (each sample stands for samplingInterval bytes on average).
      sampled = profile.samples.reduce((a, s) => a + s.size, 0);
      const self = new Map();
      const walk = (n) => {
        const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}:${n.callFrame.columnNumber}`;
        self.set(k, (self.get(k) ?? 0) + n.selfSize);
        for (const c of n.children) walk(c);
      };
      walk(profile.head);
      top = [...self.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k, b]) => [k, b]);
    }
    const d = rafOut.d;
    const rafAvg = d.reduce((a, b) => a + b, 0) / Math.max(1, d.length);
    const info = await page.evaluate(() => ({
      info: window.__mcInfo(),
      dynres: window.__mcDynres(),
      stats: typeof window.__mcStats,
    }));
    const avg = d.length > 0 ? rafAvg : median(polls.map((p) => p.avg));
    const frames = d.length > 0 ? d.length : (seconds * 1000) / avg;
    const script = (metric(m1, "ScriptDuration") - metric(m0, "ScriptDuration")) * 1000;
    const task = (metric(m1, "TaskDuration") - metric(m0, "TaskDuration")) * 1000;
    const row = {
      round,
      variant: v.name,
      appliedScale,
      seconds: r2(seconds),
      frameAvgMs: r2(avg),
      frameP95Ms: r2(median(polls.map((p) => p.p95))),
      fps: r2(1000 / avg),
      rafFrames: d.length,
      rafP50Ms: r2(pct(d, 0.5)),
      rafP95Ms: r2(pct(d, 0.95)),
      rafP99Ms: r2(pct(d, 0.99)),
      rafMaxMs: r2(d.length ? Math.max(...d) : NaN),
      offScaleFrames: rafOut.off,
      holdFrames: rafOut.n,
      polls,
      scriptMsPerS: r2(script / seconds),
      taskMsPerS: r2(task / seconds),
      scriptMsPerFrame: r2(script / frames),
      taskMsPerFrame: r2(task / frames),
      allocKBPerS: r2(sampled / 1024 / seconds),
      allocBytesPerFrame: r2(sampled / frames),
      heapUsedMB: r2(metric(m1, "JSHeapUsedSize") / 1048576),
      backend: info.info.backend,
      preset: info.info.preset,
      gpu: info.info.gpu,
      debugModule: info.stats !== "undefined",
      dynres: {
        enabled: info.dynres.enabled,
        pinned: info.dynres.pinned,
        scale: info.dynres.scale,
        signal: info.dynres.signal,
        p90Ms: info.dynres.p90Ms,
        steps: info.dynres.steps,
      },
      topAlloc: top,
      errors,
    };
    rows.push(row);
    console.log(JSON.stringify({ ...row, polls: undefined, topAlloc: top.slice(0, 3) }));
    await cdp.detach();
    await page.close();
  }
}
await browser.close();
const summary = {};
for (const v of variants) {
  const mine = rows.filter((r) => r.variant === v.name);
  const keys = [
    "frameAvgMs",
    "frameP95Ms",
    "fps",
    "rafP50Ms",
    "rafP95Ms",
    "rafP99Ms",
    "offScaleFrames",
    "scriptMsPerFrame",
    "taskMsPerFrame",
    "scriptMsPerS",
    "allocKBPerS",
    "allocBytesPerFrame",
  ];
  summary[v.name] = Object.fromEntries(
    keys.map((k) => [k, { median: r2(median(mine.map((r) => r[k]))), all: mine.map((r) => r[k]) }]),
  );
}
console.log("summary", JSON.stringify(summary));
fs.writeFileSync(
  path.join(out, `gpu-timing-ab-${args.tag ?? "typical"}.json`),
  JSON.stringify({ base: BASE, query, scale, warm, windows, rounds, hold, vsync, heap, rows, summary }, null, 1),
);
