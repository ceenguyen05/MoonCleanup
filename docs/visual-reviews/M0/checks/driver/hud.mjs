// `?perf=1` HUD cost: frame-ms delta with the perf HUD visible vs hidden (M0-visual-checks).
//   node hud.mjs --out <dir> [--preset low] [--backend webgpu] [--scene typical] [--scale 0.75] [--windows 8] [--seconds 8]
// Free-running page (no `?capture=1`), Chrome with `--disable-frame-rate-limit` so a cost shows as frame time instead of hiding
// in the vsync quantum. One page; the HUD is toggled with `window.__mcPerfHud(visible)` in alternating windows (ON, OFF, ON, ...)
// so drift cancels. Per window: `__mcStats()` frame interval (avg / p50 / p95) after `__mcStatsReset()`, and the duration of the
// debug module's own frame step from the User Timing spans `mc:debug:update`.
import fs from "node:fs";
import path from "node:path";
import { launch, openPage, parseArgs, pct, fx } from "./lib.mjs";

const args = parseArgs();
const out = path.resolve(args.out ?? "out-hud");
fs.mkdirSync(out, { recursive: true });
const preset = args.preset ?? "low";
const backend = args.backend ?? "webgpu";
const scene = args.scene ?? "typical";
const scale = args.scale ?? "0.75";
const windows = Number(args.windows ?? 8);
const seconds = Number(args.seconds ?? 8);

const browser = await launch(["--disable-frame-rate-limit"]);
const { page, errors, url } = await openPage(browser, `scene=${scene}&preset=${preset}&backend=${backend}&scale=${scale}&perf=1&hud=0`, { capture: false, hook: false });
await page.evaluate(() => {
  window.__dbg = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (e.name === "mc:debug:update") window.__dbg.push(e.duration);
  }).observe({ entryTypes: ["measure"] });
});
await page.waitForTimeout(10000);
const rows = [];
for (let i = 0; i < windows; i++) {
  const visible = i % 2 === 0;
  await page.evaluate((v) => window.__mcPerfHud(v), visible);
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    window.__mcStatsReset();
    window.__dbg.length = 0;
  });
  await page.waitForTimeout(seconds * 1000);
  const r = await page.evaluate(() => ({ s: window.__mcStats(), dbg: window.__dbg.slice(), hud: window.__mcPerfHud() }));
  const row = {
    window: i,
    hudVisible: r.hud,
    frames: r.s.frames,
    frameAvg: fx(r.s.frameMs.avg, 3),
    frameP50: fx(r.s.frameMs.p50, 2),
    frameP95: fx(r.s.frameMs.p95, 2),
    cpuTotalAvg: fx(r.s.cpuTotalMs.avg, 3),
    debugStepSamples: r.dbg.length,
    debugStepAvg: fx(r.dbg.reduce((a, b) => a + b, 0) / Math.max(1, r.dbg.length), 4),
    debugStepP95: fx(pct(r.dbg, 0.95), 3),
    debugStepMax: fx(Math.max(0, ...r.dbg), 2),
    renderScale: r.s.env.renderScale,
  };
  rows.push(row);
  console.log(JSON.stringify(row));
  if (i === windows - 2) await page.screenshot({ path: path.join(out, `hud-on-${preset}-${backend}.png`) });
}
const mean = (list, key) => list.reduce((a, r) => a + r[key], 0) / Math.max(1, list.length);
const on = rows.filter((r) => r.hudVisible);
const off = rows.filter((r) => !r.hudVisible);
const delta = {};
for (const key of ["frameAvg", "frameP50", "frameP95", "cpuTotalAvg", "debugStepAvg", "debugStepP95"]) {
  delta[key] = { on: fx(mean(on, key), 3), off: fx(mean(off, key), 3), delta: fx(mean(on, key) - mean(off, key), 3), spreadOn: fx(Math.max(...on.map((r) => r[key])) - Math.min(...on.map((r) => r[key])), 3), spreadOff: fx(Math.max(...off.map((r) => r[key])) - Math.min(...off.map((r) => r[key])), 3) };
}
console.log("delta", JSON.stringify(delta));
console.log("errors", errors.length, errors.slice(0, 3));
fs.writeFileSync(path.join(out, `hud-cost-${preset}-${backend}.json`), JSON.stringify({ url, rows, delta, errors }, null, 1));
await browser.close();
