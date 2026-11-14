// M0 look-polish r2b item 2: shadow-edge kernel A/B (look and frame cost).
//   node r2b-shadow.mjs --out <dir> [--part look|cost] [--preset medium] [--backend webgpu] [--variants before,new,tent4r1]
//                       [--rounds 3] [--warm 6] [--seconds 8] [--tag x]
// Variants (URL knobs):
//   before   shadowfilter=tent4&pcf=1.5   the kernel Low / Medium shipped before (radius 1.5: half-texel hole)
//   new      (no knob)                    the shipped default: pcf3 on cascade 0, tent4 at radius 1 beyond
//   tent4r1  shadowfilter=tent4           tent4 at its hole-free radius on every cascade (same shader as `before`)
//   pcf3all  shadowfilter=pcf3            the exact tent on every cascade
// look: S05 Medium, sun 60 / az 250, stepped capture; crops (x4, nearest) of the post shadow (cascade 0) and the wall shadow
//       (far cascade), and the 10-90 % width + flat-step length of the luma profile across each edge.
// cost: `typical` scene free-running (no vsync), scale pinned to the preset ceiling; one page per variant per round, the
//       order rotated each round so drift does not favour a variant; frame ms per page and the median per variant.
import fs from "node:fs";
import path from "node:path";
import { launch, openPage, grab, crop, writePng, lumaPlane, bilinear, project, info, parseArgs, fx } from "./lib.mjs";

const args = parseArgs();
const out = path.resolve(args.out ?? "out-r2b-shadow");
fs.mkdirSync(out, { recursive: true });
const part = args.part ?? "look";
const backend = args.backend ?? "webgpu";
const preset = args.preset ?? "medium";
const VARIANTS = {
  before: "&shadowfilter=tent4&pcf=1.5",
  new: "",
  tent4r1: "&shadowfilter=tent4",
  pcf3all: "&shadowfilter=pcf3",
};
const variants = (args.variants ?? "before,new,tent4r1").split(",");
const tag = args.tag ? `-${args.tag}` : "";
const result = { backend, preset, variants: Object.fromEntries(variants.map((v) => [v, VARIANTS[v]])) };

/** Luma profile along a segment (canvas px), `n` samples. */
function profile(img, plane, p0, p1, n) {
  const values = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    values.push(bilinear(plane, img.w, img.h, p0.x + (p1.x - p0.x) * t, p0.y + (p1.y - p0.y) * t));
  }
  return values;
}
/** 10-90 % width (in samples) and the longest run of samples inside 25-75 % whose neighbours differ by < 1.5 % of the range. */
function edgeStats(values) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const norm = values.map((v) => (v - lo) / Math.max(hi - lo, 1e-6));
  const rising = norm[norm.length - 1] > norm[0];
  const seq = rising ? norm : norm.slice().reverse();
  const first = (level) => seq.findIndex((v) => v >= level);
  let run = 0;
  let longest = 0;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] > 0.25 && seq[i] < 0.75 && Math.abs(seq[i] - seq[i - 1]) < 0.015) run++;
    else run = 0;
    longest = Math.max(longest, run);
  }
  return { lo: fx(lo), hi: fx(hi), width1090: first(0.9) - first(0.1), flatRun: longest };
}

if (part === "look") {
  const browser = await launch();
  result.look = {};
  for (const [view, name, target, half] of [
    // Post at the origin: the shadow runs to (0.2, 0, 0.54); profile from its centre line across one side edge, half way.
    ["post", "post", [0.1 + 0.061, 0, 0.27 - 0.022], [0.061, -0.022]],
    // Wall (8, *, 0), top edge at y 2.4, z 0.15: its shadow boundary on the ground is the line z = 1.45; about 22 m away.
    ["wide", "wall", [8.5, 0, 1.45], [0, 0.6]],
  ]) {
    for (const variant of variants) {
      const q = `scene=s05&view=${view}&sun=60&az=250&preset=${preset}&backend=${backend}&scale=1&hud=0${VARIANTS[variant]}`;
      const { page, errors } = await openPage(browser, q, { hook: false });
      await page.addStyleTag({ content: "#mc-overlay,#mc-perf-hud,[data-mc-ui]{display:none !important}" });
      const img = await grab(page, { settle: 30, file: path.join(out, `s05-${view}-${variant}${tag}.png`) });
      const meta = await info(page);
      const [c, p0, p1] = await project(page, [
        target,
        [target[0] - half[0], 0, target[2] - half[1]],
        [target[0] + half[0], 0, target[2] + half[1]],
      ]);
      const plane = lumaPlane(img);
      const lengthPx = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const stats = edgeStats(profile(img, plane, p0, p1, Math.max(8, Math.round(lengthPx * 2))));
      const pxPerM = lengthPx / (2 * Math.hypot(half[0], half[1]));
      writePng(path.join(out, `crop-${name}-${variant}${tag}.png`), crop(img, c.x - 120, c.y - 80, 240, 160, 4));
      result.look[`${name}:${variant}`] = {
        filter: meta.look.shadowFilter,
        knobs: meta.look.knobs,
        cascades: meta.look.cascades.map((k) => `${fx(k.texelM * 100, 2)} cm to ${fx(k.endM, 1)} m`),
        edgeWidthCm: fx((stats.width1090 / 2 / pxPerM) * 100, 2),
        flatRunCm: fx((stats.flatRun / 2 / pxPerM) * 100, 2),
        ...stats,
        pxPerM: fx(pxPerM),
        errors,
      };
      console.log(name, variant, JSON.stringify(result.look[`${name}:${variant}`]));
      await page.close();
    }
  }
  await browser.close();
}

if (part === "cost") {
  const browser = await launch(["--disable-frame-rate-limit", "--disable-gpu-vsync"]);
  const warm = Number(args.warm ?? 6);
  const seconds = Number(args.seconds ?? 8);
  const rounds = Number(args.rounds ?? 3);
  const rows = [];
  for (let round = 0; round < rounds; round++) {
    const order = variants.map((_, i) => variants[(i + round) % variants.length]);
    if (round % 2 === 1) order.reverse();
    for (const variant of order) {
      const q = `scene=typical&view=play&preset=${preset}&backend=${backend}&scale=ceil&hud=0${VARIANTS[variant]}`;
      const { page, errors } = await openPage(browser, q, { capture: false, hook: false });
      await page.waitForTimeout(warm * 1000);
      await page.evaluate(() => window.__mcStatsReset());
      await page.waitForTimeout(seconds * 1000);
      const r = await page.evaluate(() => ({ s: window.__mcStats(), look: window.__mcLook.info() }));
      const row = {
        round,
        variant,
        filter: r.look.shadowFilter,
        knobs: r.look.knobs,
        frames: r.s.frames,
        frameAvg: fx(r.s.frameMs.avg, 2),
        frameP50: fx(r.s.frameMs.p50, 2),
        frameP95: fx(r.s.frameMs.p95, 2),
        renderScale: r.s.env?.renderScale,
        errors: errors.length,
      };
      rows.push(row);
      console.log(preset, JSON.stringify(row));
      if (round === rounds - 1) await page.screenshot({ path: path.join(out, `typical-${preset}-${variant}${tag}.png`) });
      await page.close();
    }
  }
  const median = (list) => {
    const a = list.slice().sort((x, y) => x - y);
    return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
  };
  const summary = {};
  for (const variant of variants) {
    const mine = rows.filter((r) => r.variant === variant);
    summary[variant] = {
      p50Median: fx(median(mine.map((r) => r.frameP50)), 2),
      p50All: mine.map((r) => r.frameP50),
      avgMedian: fx(median(mine.map((r) => r.frameAvg)), 2),
      avgAll: mine.map((r) => r.frameAvg),
      p95Median: fx(median(mine.map((r) => r.frameP95)), 2),
    };
  }
  const base = summary[variants[0]];
  for (const variant of variants.slice(1)) {
    summary[variant].deltaP50Ms = fx(summary[variant].p50Median - base.p50Median, 2);
    summary[variant].deltaAvgMs = fx(summary[variant].avgMedian - base.avgMedian, 2);
  }
  result.cost = { rows, summary };
  console.log(preset, "summary", JSON.stringify(summary));
  await browser.close();
}
fs.writeFileSync(path.join(out, `r2b-shadow-${part}-${preset}-${backend}${tag}.json`), JSON.stringify(result, null, 1));
