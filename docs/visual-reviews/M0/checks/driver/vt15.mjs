// VT-M0-15: horizon-map term on / off on the P4 dawn flyover, measured (M0-visual-checks).
//   node vt15.mjs --out <dir> --backend webgpu|webgl2 --preset medium|high [--ts 0.25,0.5,0.75] [--sun 4] [--az 100]
//
// Scene: `?scene=s01&view=fly:<t>&terrain=/assets/terrain/` (baked LOLA cap + baked horizon map), sun 4 degrees.
// Captures per flyover position, toggled at runtime (no reload):
//   ON   shipped frame, horizon term on          OFF  shipped frame, horizon term off (`__mcLook.setHorizon`)
//   U    nothing casts and horizon off (ground truth "lit"; terrain N.L shading stays, so it cancels in the ratios)
// World ground samples (height from the scene's own height function) are projected with `__mcLook.project`; per sample
//   f = 1 - frame / U  (shadow darkening, 0 = lit) and D = U - frame (codes), with the view depth of the sample.
// Reported:
//   1. shadowed ground share (f > 0.25) by view depth, inside vs beyond the CSM far distance, ON vs OFF
//      ("terrain shadows continue past CSM max far")
//   2. seam step: ring means of D in 4 m depth rings; largest step between neighbouring rings within +-16 m of the CSM far
//      distance, against the same statistic away from the seam ("no luma step > 8 on flat ground")
//   3. shadow edge 10-90 % widths on lateral cuts (perpendicular to the sun azimuth) just inside the CSM range (cascade edges,
//      from OFF) and just beyond it (horizon-map edges, from ON): medians in metres and px, and their ratio (<= 2x asked)
// Samples hidden behind terrain are not removed (30 m altitude, 8 degrees pitch: few).
import fs from "node:fs";
import path from "node:path";
import { launch, openPage, step, grab, info, parseArgs, lumaPlane, bilinear, pct, fx } from "./lib.mjs";

const args = parseArgs();
const out = path.resolve(args.out ?? "out-vt15");
fs.mkdirSync(out, { recursive: true });
const backend = args.backend ?? "webgpu";
const preset = args.preset ?? "medium";
const ts = (args.ts ?? "0.25,0.5,0.75").split(",").map(Number);
const sun = Number(args.sun ?? 4);
const az = Number(args.az ?? 100);
const temporal = preset === "high" || preset === "ultra";
const settle = Number(args.settle ?? (temporal ? 20 : 3));
const tag = `${preset}-${backend}`;

const browser = await launch();
const query = `scene=s01&view=fly:${ts[0]}&sun=${sun}&az=${az}&preset=${preset}&backend=${backend}&scale=1&terrain=${encodeURIComponent("/assets/terrain/")}${args.extra ? "&" + args.extra : ""}`;
const { page, errors, url } = await openPage(browser, query);
await page.waitForFunction(() => window.__mcLook?.isReady() === true, null, { timeout: 240000 });
await step(page, 3);
await page.evaluate(async () => {
  const { SceneKit } = await import("/src/visuals/lookdev/scene-base.ts");
  const vx = window.__vx;
  /** points: [[x, z], ...] -> flat [px, py, depth, visible] per point. */
  vx.sampleGround = (points) => {
    const cam = vx.roots.camera;
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.clone().invert().elements;
    const height = vx.scene.height;
    const outA = new Array(points.length * 4);
    for (let i = 0; i < points.length; i++) {
      const x = points[i][0];
      const z = points[i][1];
      const y = SceneKit.surfaceY(x, z, height) + 0.03;
      const p = window.__mcLook.project(x, y, z);
      outA[i * 4] = p.x;
      outA[i * 4 + 1] = p.y;
      outA[i * 4 + 2] = -(e[2] * x + e[6] * y + e[10] * z + e[14]);
      outA[i * 4 + 3] = p.visible ? 1 : 0;
    }
    return outA;
  };
});
const meta = await info(page);
const farM = meta.look.cascades.at(-1).endM;
console.log(tag, "ready; cascades", JSON.stringify(meta.look.cascades.map((c) => [fx(c.texelM * 100, 1), fx(c.endM, 0)])), "far", farM, meta.look.postPasses.join(">"));

const horizon = (on) => page.evaluate((v) => window.__mcLook.setHorizon(v), on);
const cast = (on) => page.evaluate((v) => window.__vx.mode(v ? "real" : "unshadowed"), on);

const results = [];
for (const t of ts) {
  await page.evaluate((v) => window.__mcLook.setView(`fly:${v}`), t);
  await cast(true);
  await horizon(true);
  const ON = await grab(page, { settle, file: path.join(out, `fly-${t}-${tag}-horizonOn.png`) });
  await horizon(false);
  const OFF = await grab(page, { settle, file: path.join(out, `fly-${t}-${tag}-horizonOff.png`) });
  await cast(false);
  const U = await grab(page, { settle });
  await cast(true);
  await horizon(true);
  const w = ON.w;
  const h = ON.h;
  const lOn = lumaPlane(ON);
  const lOff = lumaPlane(OFF);
  const lU = lumaPlane(U);
  const camZ = -150 + 300 * t;

  const sampleAt = async (points) => {
    const flat = await page.evaluate((p) => window.__vx.sampleGround(p), points);
    const rows = [];
    for (let i = 0; i < points.length; i++) {
      const x = flat[i * 4];
      const y = flat[i * 4 + 1];
      if (!flat[i * 4 + 3] || x < 1 || y < 1 || x > w - 2 || y > h - 2) {
        rows.push(null);
        continue;
      }
      const u = bilinear(lU, w, h, x, y);
      const on = bilinear(lOn, w, h, x, y);
      const off = bilinear(lOff, w, h, x, y);
      rows.push({ x, y, depth: flat[i * 4 + 2], u, on, off, fOn: u > 6 ? 1 - on / u : 0, fOff: u > 6 ? 1 - off / u : 0 });
    }
    return rows;
  };

  // 1 + 2: ground grid, 1 m.
  const grid = [];
  for (let dz = 30; dz <= 340; dz += 1) for (let x = -Math.min(140, dz * 0.7); x <= Math.min(140, dz * 0.7); x += 1) grid.push([x, camZ + dz]);
  const g = (await sampleAt(grid)).filter(Boolean);
  const RING = 4;
  const rings = new Map();
  for (const s of g) {
    const k = Math.floor(s.depth / RING);
    let r = rings.get(k);
    if (!r) rings.set(k, (r = { n: 0, dOn: 0, dOff: 0, shOn: 0, shOff: 0, lumaOn: 0, lumaOff: 0, u: 0 }));
    r.n++;
    r.dOn += s.u - s.on;
    r.dOff += s.u - s.off;
    r.lumaOn += s.on;
    r.lumaOff += s.off;
    r.u += s.u;
    if (s.fOn > 0.25) r.shOn++;
    if (s.fOff > 0.25) r.shOff++;
  }
  const ring = [...rings.entries()]
    .filter(([, r]) => r.n >= 40)
    .sort((a, b) => a[0] - b[0])
    .map(([k, r]) => ({ depth: (k + 0.5) * RING, n: r.n, dOn: r.dOn / r.n, dOff: r.dOff / r.n, shOn: r.shOn / r.n, shOff: r.shOff / r.n, lumaOn: r.lumaOn / r.n, lumaOff: r.lumaOff / r.n, u: r.u / r.n }));
  const zone = (lo, hi) => {
    const rs = ring.filter((r) => r.depth >= lo && r.depth < hi);
    const n = rs.reduce((a, r) => a + r.n, 0) || 1;
    const m = (key) => rs.reduce((a, r) => a + r[key] * r.n, 0) / n;
    return { depthM: [lo, hi], samples: n, shadowShareOn: fx(m("shOn"), 3), shadowShareOff: fx(m("shOff"), 3), lumaOn: fx(m("lumaOn"), 1), lumaOff: fx(m("lumaOff"), 1), lumaUnshadowed: fx(m("u"), 1) };
  };
  const maxDepth = ring.at(-1)?.depth ?? 0;
  const zones = [zone(40, farM - 20), zone(farM - 20, farM), zone(farM, farM + 20), zone(farM + 20, Math.min(maxDepth, farM + 120)), zone(farM + 120, maxDepth + RING)];
  const steps = (key, lo, hi) => {
    let worst = 0;
    let at = 0;
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1];
      const b = ring[i];
      if (b.depth < lo || b.depth > hi) continue;
      const d = Math.abs(b[key] - a[key]);
      if (d > worst) {
        worst = d;
        at = b.depth;
      }
    }
    return { step: fx(worst, 2), atDepth: at };
  };
  const seam = {
    ringM: RING,
    on: { atSeam: steps("lumaOn", farM - 16, farM + 16), elsewhere: steps("lumaOn", 50, farM - 24), beyond: steps("lumaOn", farM + 24, maxDepth) },
    off: { atSeam: steps("lumaOff", farM - 16, farM + 16), elsewhere: steps("lumaOff", 50, farM - 24), beyond: steps("lumaOff", farM + 24, maxDepth) },
    shadowDarkeningOn: { atSeam: steps("dOn", farM - 16, farM + 16), elsewhere: steps("dOn", 50, farM - 24) },
    shadowDarkeningOff: { atSeam: steps("dOff", farM - 16, farM + 16), elsewhere: steps("dOff", 50, farM - 24) },
  };

  // 3: lateral cuts, 5 cm.
  const edgesOn = { inside: [], beyond: [] };
  const edgesOff = { inside: [], beyond: [] };
  const cutDz = [];
  for (let dz = farM - 46; dz <= farM - 10; dz += 4) cutDz.push(dz);
  for (let dz = farM + 6; dz <= farM + 70; dz += 4) cutDz.push(dz);
  for (const dz of cutDz) {
    const pts = [];
    const half = Math.min(150, dz * 0.75);
    for (let x = -half; x <= half; x += 0.05) pts.push([x, camZ + dz]);
    const s = await sampleAt(pts);
    for (const [key, store] of [["fOn", edgesOn], ["fOff", edgesOff]]) {
      const vals = s.map((q) => (q ? q[key] : NaN));
      const full = pct(vals.filter((v) => v > 0.3), 0.5);
      if (!(full > 0.3)) continue;
      const lo = 0.1 * full;
      const hi = 0.9 * full;
      // Walk the cut; an edge is a monotone run between the last sample <= lo and the first sample >= hi (either direction).
      let lastLow = -1;
      let lastHigh = -1;
      for (let i = 0; i < vals.length; i++) {
        const v = vals[i];
        if (!Number.isFinite(v)) {
          lastLow = lastHigh = -1;
          continue;
        }
        if (v <= lo) {
          if (lastHigh >= 0 && i - lastHigh < 600) record(store, s, lastHigh, i, dz);
          lastLow = i;
          lastHigh = -1;
        } else if (v >= hi) {
          if (lastLow >= 0 && i - lastLow < 600) record(store, s, lastLow, i, dz);
          lastHigh = i;
          lastLow = -1;
        }
      }
    }
  }
  function record(store, s, i0, i1, dz) {
    const a = s[i0];
    const b = s[i1];
    if (!a || !b) return;
    const widthM = (i1 - i0) * 0.05;
    const widthPx = Math.hypot(b.x - a.x, b.y - a.y);
    const depth = (a.depth + b.depth) / 2;
    (depth < farM ? store.inside : store.beyond).push({ widthM, widthPx, depth, dz });
  }
  const summary = (list) => ({ n: list.length, medianM: fx(pct(list.map((e) => e.widthM), 0.5), 2), p25M: fx(pct(list.map((e) => e.widthM), 0.25), 2), p75M: fx(pct(list.map((e) => e.widthM), 0.75), 2), medianPx: fx(pct(list.map((e) => e.widthPx), 0.5), 1) });
  const edge = {
    cascadeEdgesInside: summary(edgesOff.inside), // horizon off: only cascade shadows exist
    horizonOnInside: summary(edgesOn.inside),
    horizonEdgesBeyond: summary(edgesOn.beyond), // beyond the cascades only the horizon term casts
    cascadeEdgesBeyond: summary(edgesOff.beyond), // expected: none
  };
  edge.ratioM = fx(edge.horizonEdgesBeyond.medianM / edge.cascadeEdgesInside.medianM, 2);
  edge.ratioPx = fx(edge.horizonEdgesBeyond.medianPx / edge.cascadeEdgesInside.medianPx, 2);
  const r = { t, cameraZ: camZ, csmFarM: farM, zones, seam, edge, ring: ring.map((q) => ({ depth: q.depth, n: q.n, lumaOn: fx(q.lumaOn, 1), lumaOff: fx(q.lumaOff, 1), u: fx(q.u, 1), shOn: fx(q.shOn, 3), shOff: fx(q.shOff, 3) })) };
  results.push(r);
  console.log(`t=${t}`, JSON.stringify({ zones, seam, edge }));
}
fs.writeFileSync(path.join(out, `vt15-${tag}.json`), JSON.stringify({ url, meta, sun, az, results, errors }, null, 1));
console.log(tag, "errors", errors.length, errors.slice(0, 3));
await browser.close();
