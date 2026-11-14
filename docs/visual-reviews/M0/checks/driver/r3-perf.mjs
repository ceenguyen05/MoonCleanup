// M0 look-polish round 3: free-running frame-time A/B of URL variants (no vsync), pages loaded in rotated order.
//   node r3-perf.mjs --out <dir> --tag <name> --base "scene=s06&preset=low&backend=webgpu&scale=ceil" \
//        --variants "base=;nolampshadow=off=lampshadow;nocsm=cascades=0" [--rounds 2] [--warm 6] [--seconds 8]
// A variant is `name=<query fragment>` (the fragment may be empty and may contain `&` and `=`). `--base` may also be a `;`
// list of `name=query` scenes with `--variants` omitted (then every scene is one variant).
// Per page: `__mcStats()` frame interval after a reset (frames, avg, p50, p95, p99) and GPU ms when the timer reports it.
// Summary per variant: median over its pages, and the delta of the p50 median against the FIRST variant.
import fs from "node:fs";
import path from "node:path";
import { launch, openPage, parseArgs, fx } from "./lib.mjs";

const args = parseArgs();
const out = path.resolve(args.out ?? "out-r3");
fs.mkdirSync(out, { recursive: true });
const tag = args.tag ?? "perf";
const warm = Number(args.warm ?? 6);
const seconds = Number(args.seconds ?? 8);
const rounds = Number(args.rounds ?? 2);
const base = args.base ?? "";
const variants = (args.variants ?? "base=")
  .split(";")
  .filter((v) => v !== "")
  .map((v) => {
    const i = v.indexOf("=");
    return { name: v.slice(0, i), query: v.slice(i + 1) };
  });

const browser = await launch(["--disable-frame-rate-limit", "--disable-gpu-vsync"]);
const rows = [];
for (let round = 0; round < rounds; round++) {
  const order = variants.map((_, i) => variants[(i + round) % variants.length]);
  if (round % 2 === 1) order.reverse();
  for (const variant of order) {
    const q = [base, variant.query, "hud=0"].filter((s) => s !== "").join("&");
    let row;
    try {
      const { page, errors } = await openPage(browser, q, { capture: false, hook: false });
      await page.waitForTimeout(warm * 1000);
      await page.evaluate(() => {
        window.__mcStatsReset();
        // Frame intervals from rAF (independent of the app's own collector): for the hitch pattern.
        const rec = (window.__r3 = { t: [], on: true });
        const tick = (now) => {
          if (!rec.on) return;
          rec.t.push(now);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await page.waitForTimeout(seconds * 1000);
      const r = await page.evaluate(() => {
        const rec = window.__r3;
        rec.on = false;
        const d = [];
        for (let i = 1; i < rec.t.length; i++) d.push(rec.t[i] - rec.t[i - 1]);
        // Hitches: intervals over 1.6 x the median; their start times (s) show whether they are periodic.
        const sorted = d.slice().sort((a, b) => a - b);
        const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
        const hitchAt = [];
        let over33 = 0;
        let over50 = 0;
        let hitchMs = 0;
        d.forEach((v, i) => {
          if (v > 33.4) over33++;
          if (v > 50) over50++;
          if (v > med * 1.6) {
            hitchAt.push(+((rec.t[i] - rec.t[0]) / 1000).toFixed(2));
            hitchMs += v - med;
          }
        });
        return {
          s: window.__mcStats(),
          look: window.__mcLook?.info?.(),
          mc: window.__mcInfo?.(),
          raf: { n: d.length, med: +med.toFixed(2), over33, over50, max: +(sorted[sorted.length - 1] ?? 0).toFixed(1), hitches: hitchAt.length, hitchMs: +hitchMs.toFixed(0), hitchAt: hitchAt.slice(0, 40) },
        };
      });
      const gpu = r.s.gpuMs ?? r.s.gpuFrameMs ?? null;
      row = {
        round,
        variant: variant.name,
        frames: r.s.frames,
        fps: fx(1000 / r.s.frameMs.avg, 1),
        avg: fx(r.s.frameMs.avg, 2),
        p50: fx(r.s.frameMs.p50, 2),
        p95: fx(r.s.frameMs.p95, 2),
        p99: fx(r.s.frameMs.p99 ?? NaN, 1),
        gpuP50: gpu && gpu.samples > 0 ? fx(gpu.p50, 2) : null,
        scale: r.s.env?.renderScale,
        filter: r.look?.shadowFilter,
        passes: r.look?.postPasses?.join(">"),
        knobs: r.look?.knobs,
        draws: r.s.draws?.avg !== undefined ? fx(r.s.draws.avg, 0) : (r.mc?.render?.calls ?? null),
        tris: r.s.triangles?.avg !== undefined ? fx(r.s.triangles.avg, 0) : (r.mc?.render?.triangles ?? null),
        errors: errors.length,
        firstError: errors[0],
        raf: r.raf,
      };
      if (round === rounds - 1 && args.shots === "1") await page.screenshot({ path: path.join(out, `${tag}-${variant.name}.png`) });
      await page.close();
    } catch (error) {
      row = { round, variant: variant.name, failed: String(error).slice(0, 200) };
    }
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
await browser.close();

const median = (list) => {
  const a = list.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (a.length === 0) return NaN;
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};
const summary = {};
for (const variant of variants) {
  const mine = rows.filter((r) => r.variant === variant.name && !r.failed);
  summary[variant.name] = {
    pages: mine.length,
    fps: fx(median(mine.map((r) => r.fps)), 1),
    p50: fx(median(mine.map((r) => r.p50)), 2),
    p50All: mine.map((r) => r.p50),
    p95: fx(median(mine.map((r) => r.p95)), 2),
    p95All: mine.map((r) => r.p95),
    avg: fx(median(mine.map((r) => r.avg)), 2),
  };
}
const first = summary[variants[0].name];
for (const variant of variants.slice(1)) summary[variant.name].deltaP50 = fx(summary[variant.name].p50 - first.p50, 2);
console.log("summary", JSON.stringify(summary));
fs.writeFileSync(path.join(out, `r3-perf-${tag}.json`), JSON.stringify({ base, variants, warm, seconds, rounds, rows, summary }, null, 1));
