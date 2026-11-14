// M0 look-polish r2, VT-M0-13: the star part of sky.mjs (same star selection, tracking and statistics, so the numbers are
// comparable with M0-visual-checks), plus `--extra "k=v&.."` for look knobs (`stars=scene` = stars inside the scene pass)
// and a STILL phase before the pan: `--still n` held frames, per-star peak variation with the camera at rest (under TRAA
// this is the check that the layer cancels the camera jitter).
//   node r2-stars.mjs --out <dir> [--preset high] [--backend webgpu] [--frames 90] [--still 12] [--extra "stars=scene"] [--tag layer]
import fs from "node:fs";
import path from "node:path";
import { launch, openPage, step, setPose, info, parseArgs, lumaPlane, decode, crop, writePng, pct, fx } from "./lib.mjs";

const args = parseArgs();
const out = path.resolve(args.out ?? "out-r2-stars");
fs.mkdirSync(out, { recursive: true });
const todo = ["stars"];
const preset = args.preset ?? "high";
const backend = args.backend ?? "webgpu";
const temporal = preset === "high" || preset === "ultra";
const tag = `${args.tag ?? "layer"}-${preset}-${backend}`;
const DEG = Math.PI / 180;
const result = { preset, backend, extra: args.extra ?? "" };
const browser = await launch();

if (todo.includes("stars")) {
  const { page, errors } = await openPage(browser, `scene=s06&view=wide&preset=${preset}&backend=${backend}&scale=1${args.extra ? "&" + args.extra : ""}`);
  result.look = (await info(page)).look;
  console.log("post", result.look.postPasses.join(">"), "knobs", result.look.knobs);
  const frames = Number(args.frames ?? 90);
  const SKIP = Number(args.skip ?? 12);
  const RATE = 2; // deg per second
  const P = [-9, 3.6, -9];
  const poseAt = (k) => {
    const yaw = 10 + (RATE * k) / 60;
    const pitch = 14;
    const d = [Math.sin(yaw * DEG) * Math.cos(pitch * DEG), Math.sin(pitch * DEG), Math.cos(yaw * DEG) * Math.cos(pitch * DEG)];
    return { position: P, target: [P[0] + d[0] * 50, P[1] + d[1] * 50, P[2] + d[2] * 50] };
  };
  await setPose(page, poseAt(0));
  await step(page, temporal ? 40 : 6);
  const snap = async (file) => {
    await page.waitForTimeout(250);
    return decode(await page.screenshot(file ? { path: file } : {}));
  };
  const first = await snap(path.join(out, `r2-s06-pan-first-${tag}.png`));
  const { w, h } = first;
  const skyH = Math.round(h * 0.5);
  const bgAt = (L, x, y) => {
    const v = [];
    for (let j = -7; j <= 7; j++)
      for (let i = -7; i <= 7; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) < 5) continue;
        const xx = x + i;
        const yy = y + j;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) v.push(L[yy * w + xx]);
      }
    return pct(v, 0.5);
  };
  const L0 = lumaPlane(first);
  const cands = [];
  for (let y = 12; y < skyH; y++)
    for (let x = 12; x < w - 140; x++) {
      const v = L0[y * w + x];
      if (v < 40) continue;
      let isMax = true;
      for (let j = -6; j <= 6 && isMax; j++) for (let i = -6; i <= 6; i++) if ((i || j) && L0[(y + j) * w + x + i] > v) { isMax = false; break; }
      if (!isMax) continue;
      const bg = bgAt(L0, x, y);
      if (v - bg < 30) continue;
      // Reject extended objects (Earth, lamps): the 15 x 15 ring must be near the background.
      let big = 0;
      for (let j = -9; j <= 9; j++) for (let i = -9; i <= 9; i++) if (Math.max(Math.abs(i), Math.abs(j)) >= 7 && L0[Math.min(h - 1, Math.max(0, y + j)) * w + Math.min(w - 1, Math.max(0, x + i))] > bg + 0.4 * (v - bg)) big++;
      if (big > 0) continue;
      cands.push({ x, y, peak0: v - bg, raw0: v });
    }
  cands.sort((a, b) => b.peak0 - a.peak0);
  const stars = cands.slice(0, 40).map((c) => ({ ...c, peaks: [c.peak0], flux: [], sig: [], lost: false, sat: c.raw0 >= 250 }));
  const shape = (L, x, y) => {
    const bg = bgAt(L, x, y);
    let m = 0;
    let mx = 0;
    let my = 0;
    for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
      const v = Math.max(0, L[(y + j) * w + x + i] - bg);
      m += v;
      mx += v * i;
      my += v * j;
    }
    if (m <= 0) return { flux: 0, sx: 0, sy: 0 };
    mx /= m;
    my /= m;
    let vx2 = 0;
    let vy2 = 0;
    for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
      const v = Math.max(0, L[(y + j) * w + x + i] - bg);
      vx2 += v * (i - mx) ** 2;
      vy2 += v * (j - my) ** 2;
    }
    return { flux: m, sx: Math.sqrt(vx2 / m), sy: Math.sqrt(vy2 / m) };
  };
  for (const s of stars) {
    const sh = shape(L0, s.x, s.y);
    s.flux.push(sh.flux);
    s.sig.push([sh.sx, sh.sy]);
  }
  const STILL = Number(args.still ?? 12);
  const stillPeaks = stars.map(() => []);
  for (let k = 0; k < STILL; k++) {
    await step(page, 1);
    const L = lumaPlane(await snap(null));
    stars.forEach((s, i) => {
      let best = -1;
      let bx = s.x;
      let by = s.y;
      for (let j = -2; j <= 2; j++) for (let ii = -2; ii <= 2; ii++) {
        const v = L[(s.y + j) * w + s.x + ii];
        if (v > best) { best = v; bx = s.x + ii; by = s.y + j; }
      }
      stillPeaks[i].push({ peak: best - bgAt(L, bx, by), dx: bx - s.x, dy: by - s.y });
    });
  }
  for (let k = 1; k <= frames; k++) {
    await setPose(page, poseAt(k));
    await step(page, 1);
    const img = await snap(k === frames ? path.join(out, `r2-s06-pan-last-${tag}.png`) : null);
    if (k === frames) { const b = stars.find((q) => !q.lost); if (b) writePng(path.join(out, `r2-star-moving-6x-${tag}.png`), crop(img, b.x - 16, b.y - 16, 32, 32, 6)); }
    const L = lumaPlane(img);
    for (const s of stars) {
      if (s.lost) continue;
      let best = -1;
      let bx = s.x;
      let by = s.y;
      for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
        const xx = s.x + i;
        const yy = s.y + j;
        if (xx < 10 || yy < 10 || xx >= w - 10 || yy >= skyH + 10) continue;
        const v = L[yy * w + xx];
        if (v > best) {
          best = v;
          bx = xx;
          by = yy;
        }
      }
      if (best < 0 || bx < 12 || bx > w - 12 || by < 12) {
        s.lost = true;
        continue;
      }
      s.x = bx;
      s.y = by;
      const bg = bgAt(L, bx, by);
      s.peaks.push(best - bg);
      if (best >= 250) s.sat = true;
      const sh = shape(L, bx, by);
      s.flux.push(sh.flux);
      s.sig.push([sh.sx, sh.sy]);
    }
  }
  const rows = stars
    .filter((s) => s.peaks.length >= Math.min(frames, 40))
    .map((s) => {
      // The first SKIP frames are left out: frame 0 is the converged still, and a temporal resolve needs a few frames of
      // motion to reach its moving state. `stillOverMoving` reports that step separately.
      const moving = s.peaks.slice(SKIP);
      const mx = Math.max(...moving);
      const mn = Math.min(...moving);
      const meanMoving = moving.reduce((a, b) => a + b, 0) / moving.length;
      const fmx = Math.max(...s.flux);
      const fmn = Math.min(...s.flux);
      const sx = pct(s.sig.map((q) => q[0]), 0.5);
      const sy = pct(s.sig.map((q) => q[1]), 0.5);
      return { frames: s.peaks.length, saturated: s.sat, stillPeak: fx(s.peaks[0], 1), movingMeanPeak: fx(meanMoving, 1), movingOverStill: fx(meanMoving / s.peaks[0], 3), peakMax: fx(mx, 1), peakMin: fx(mn, 1), peakVariation: fx((mx - mn) / mx, 3), fluxVariation: fx((fmx - fmn) / fmx, 3), sigmaX: fx(sx, 2), sigmaY: fx(sy, 2), roundness: fx(Math.min(sx, sy) / Math.max(sx, sy, 1e-6), 2) };
    });
  const unsat = rows.filter((r) => !r.saturated);
  const stillRows = stillPeaks.filter((q, i) => q.length > 0 && !stars[i].sat).map((q) => {
    const p = q.map((e) => e.peak);
    return { variation: (Math.max(...p) - Math.min(...p)) / Math.max(...p), moved: q.some((e) => e.dx !== 0 || e.dy !== 0) };
  });
  result.still = {
    frames: STILL,
    stars: stillRows.length,
    peakVariationMedian: fx(pct(stillRows.map((r) => r.variation), 0.5), 3),
    peakVariationWorst: fx(Math.max(0, ...stillRows.map((r) => r.variation)), 3),
    starsWhosePeakPixelMoved: stillRows.filter((r) => r.moved).length,
  };
  console.log("still", JSON.stringify(result.still));
  result.stars = {
    panDegPerS: RATE,
    frames,
    pxPerFrameAtCentre: fx((RATE / 60) * (h / 2 / Math.tan(30 * DEG)) * DEG, 2),
    tracked: rows.length,
    unsaturated: unsat.length,
    skippedFrames: SKIP,
    movingOverStillMedian: fx(pct(unsat.map((r) => r.movingOverStill), 0.5), 3),
    peakVariationMedian: fx(pct(unsat.map((r) => r.peakVariation), 0.5), 3),
    peakVariationWorst: fx(Math.max(0, ...unsat.map((r) => r.peakVariation)), 3),
    shareWithin10pct: fx(unsat.filter((r) => r.peakVariation <= 0.1).length / Math.max(1, unsat.length), 2),
    fluxVariationMedian: fx(pct(unsat.map((r) => r.fluxVariation), 0.5), 3),
    sigmaMedianPx: fx(pct(rows.map((r) => (r.sigmaX + r.sigmaY) / 2), 0.5), 2),
    roundnessMedian: fx(pct(rows.map((r) => r.roundness), 0.5), 2),
    rows,
    errors,
  };
  const biggest = stars[0];
  if (biggest) writePng(path.join(out, `r2-star-6x-${tag}.png`), crop(first, cands[0].x - 16, cands[0].y - 16, 32, 32, 6));
  console.log("stars", JSON.stringify({ ...result.stars, rows: undefined }));
  await page.close();
}
fs.writeFileSync(path.join(out, `r2-stars-${tag}.json`), JSON.stringify(result, null, 1));
await browser.close();
