// VT-M0-03 (sidecar part), VT-M0-05, VT-M0-13, VT-M0-14 (M0-visual-checks).
//   node sky.mjs --out <dir> --do cascades,sun,earth,stars [--preset medium] [--backend webgpu] [--frames 90]
//
//   cascades  S05: cascade count, map size and split ends read from the live CSM lights (VT-M0-03 sidecar part)
//   sun       S01 dawn, view a: sun-disk core colour, halo hue, adjacent-pixel steps and flat runs on lines through the halo
//             and up the sky gradient; 2x crops for the banding look (VT-M0-05)
//   earth     same page: Earth disk diameter in px and degrees at the shipped size and at `earthDiameterDeg = 2.4` (VT-M0-14)
//   stars     S06: yaw pan at 2 deg/s in 1/60 s steps, one screenshot per frame; per tracked star the peak luma above the
//             local background over the pan, plus second-moment size and roundness (VT-M0-13)
import fs from "node:fs";
import path from "node:path";
import { launch, openPage, step, setPose, grab, info, parseArgs, lumaPlane, decode, crop, writePng, pct, fx } from "./lib.mjs";

const args = parseArgs();
const out = path.resolve(args.out ?? "out-sky");
fs.mkdirSync(out, { recursive: true });
const todo = (args.do ?? "cascades,sun,earth,stars").split(",");
const preset = args.preset ?? "medium";
const backend = args.backend ?? "webgpu";
const temporal = preset === "high" || preset === "ultra";
const settle = temporal ? 20 : 3;
const tag = `${preset}-${backend}`;
const DEG = Math.PI / 180;
const result = { preset, backend };
const browser = await launch();

if (todo.includes("cascades")) {
  const { page, errors } = await openPage(browser, `scene=s05&preset=${preset}&backend=${backend}&scale=1&view=wide`);
  await step(page, 3);
  const live = await page.evaluate(() => {
    const rows = [];
    window.__vx.roots.scene.traverse((o) => {
      if (!o.isDirectionalLight) return;
      const node = o.shadow?.shadowNode;
      rows.push({
        light: o.name,
        castShadow: o.castShadow,
        cascades: node?.lights?.length ?? 0,
        maps: (node?.lights ?? []).map((l) => ({ mapPx: [l.shadow.mapSize.x, l.shadow.mapSize.y], widthM: +(l.shadow.camera.right - l.shadow.camera.left).toFixed(2), normalBiasM: +l.shadow.normalBias.toFixed(4), radius: l.shadow.radius })),
        fade: node?.fade ?? null,
        maxFar: node?.maxFar ?? null,
      });
    });
    return rows;
  });
  const meta = await info(page);
  result.cascades = { sidecar: meta.look.cascades, shadowFilter: meta.look.shadowFilter, live, errors };
  console.log("cascades", JSON.stringify(result.cascades));
  await page.close();
}

if (todo.includes("sun") || todo.includes("earth")) {
  const { page, errors } = await openPage(browser, `scene=s01&time=dawn&view=a&preset=${preset}&backend=${backend}&scale=1`);
  const dirPx = (azDeg, elDeg) =>
    page.evaluate(
      ([az, el]) => {
        const cam = window.__vx.roots.camera;
        const D = Math.PI / 180;
        const at = (a, e) => {
          const d = [Math.cos(e * D) * Math.cos(a * D), Math.sin(e * D), Math.cos(e * D) * Math.sin(a * D)];
          return window.__mcLook.project(cam.position.x + d[0] * 800, cam.position.y + d[1] * 800, cam.position.z + d[2] * 800);
        };
        const c = at(az, el);
        const up = at(az, el + 0.5);
        const side = at(az + 0.5 / Math.max(0.2, Math.cos(el * D)), el);
        return { c, pxPerDegV: Math.hypot(up.x - c.x, up.y - c.y) * 2, pxPerDegH: Math.hypot(side.x - c.x, side.y - c.y) * 2 };
      },
      [azDeg, elDeg],
    );
  const state = (await info(page)).look.state;
  const frame = await grab(page, { settle: Math.max(settle, 4), file: path.join(out, `s01-dawn-a-${tag}.png`) });
  const { w, h } = frame;
  const L = lumaPlane(frame);
  const rgb = (x, y) => {
    const i = (Math.round(y) * w + Math.round(x)) * 4;
    return [frame.data[i], frame.data[i + 1], frame.data[i + 2]];
  };

  if (todo.includes("sun")) {
    const s = await dirPx(state.sunAzimuthDeg, state.sunElevationDeg);
    const cx = Math.round(s.c.x);
    const cy = Math.round(s.c.y);
    const ringRgb = (r0, r1) => {
      const acc = [0, 0, 0];
      let n = 0;
      for (let y = cy - r1; y <= cy + r1; y++)
        for (let x = cx - r1; x <= cx + r1; x++) {
          const r = Math.hypot(x - cx, y - cy);
          if (r < r0 || r >= r1 || x < 0 || y < 0 || x >= w || y >= h) continue;
          const c = rgb(x, y);
          acc[0] += c[0];
          acc[1] += c[1];
          acc[2] += c[2];
          n++;
        }
      return acc.map((v) => fx(v / Math.max(1, n), 1));
    };
    const rings = [[0, 4], [4, 8], [8, 14], [14, 24], [24, 40], [40, 70], [70, 120], [120, 200]].map(([a, b]) => ({ rPx: [a, b], rgb: ringRgb(a, b) }));
    // Lines: left and right of the disk through the halo, and a vertical sky column well away from the sun.
    const lineStats = (pts) => {
      let maxStep = 0;
      let longest = 0;
      let run = 1;
      let longRuns = 0;
      for (let i = 1; i < pts.length; i++) {
        const d = Math.abs(pts[i] - pts[i - 1]);
        if (d > maxStep) maxStep = d;
        if (d < 0.5) run++;
        else {
          if (run > longest) longest = run;
          if (run >= 16) longRuns++;
          run = 1;
        }
      }
      return { px: pts.length, range: [fx(Math.min(...pts), 0), fx(Math.max(...pts), 0)], maxAdjacentStep: fx(maxStep, 1), longestFlatRunPx: Math.max(longest, run), flatRuns16: longRuns };
    };
    const chan = (x, y, k) => frame.data[(y * w + x) * 4 + k];
    const row = (x0, x1, y, k) => {
      const o = [];
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) o.push(chan(x, y, k));
      return o;
    };
    const col = (x, y0, y1, k) => {
      const o = [];
      for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) o.push(chan(x, y, k));
      return o;
    };
    const horizonY = Math.round((await dirPx(state.sunAzimuthDeg, 0.3)).c.y);
    result.sun = {
      centrePx: [cx, cy],
      pxPerDeg: fx(s.pxPerDegV, 1),
      core: rings[0].rgb,
      rings,
      haloRight: { red: lineStats(row(cx + 14, cx + 320, cy, 0)), green: lineStats(row(cx + 14, cx + 320, cy, 1)), blue: lineStats(row(cx + 14, cx + 320, cy, 2)) },
      haloUp: { red: lineStats(col(cx, cy - 320, cy - 14, 0)), green: lineStats(col(cx, cy - 320, cy - 14, 1)), blue: lineStats(col(cx, cy - 320, cy - 14, 2)) },
      skyColumn: { xPx: Math.min(w - 40, cx + 600), red: lineStats(col(Math.min(w - 40, cx + 600), 4, horizonY - 12, 0)), green: lineStats(col(Math.min(w - 40, cx + 600), 4, horizonY - 12, 1)), blue: lineStats(col(Math.min(w - 40, cx + 600), 4, horizonY - 12, 2)) },
    };
    writePng(path.join(out, `vt05-sun-halo-2x-${tag}.png`), crop(frame, cx - 240, cy - 150, 480, 300, 2));
    console.log("sun", JSON.stringify(result.sun));
  }

  if (todo.includes("earth")) {
    const measureEarth = async (label, img) => {
      const e = await dirPx(state.earthAzimuthDeg, state.earthElevationDeg);
      const lum = lumaPlane(img);
      const cx = Math.round(e.c.x);
      const cy = Math.round(e.c.y);
      const R = 110;
      // Sky level: median of the ring just outside the search window; disk threshold halfway to the peak.
      const ring = [];
      let peak = 0;
      for (let y = cy - R; y <= cy + R; y++)
        for (let x = cx - R; x <= cx + R; x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const r = Math.hypot(x - cx, y - cy);
          const v = lum[y * w + x];
          if (r > R - 6) ring.push(v);
          else if (v > peak) peak = v;
        }
      const sky = pct(ring, 0.5);
      const thr = sky + 0.35 * (peak - sky);
      const pts = [];
      for (let y = cy - R; y <= cy + R; y++)
        for (let x = cx - R; x <= cx + R; x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          if (Math.hypot(x - cx, y - cy) <= R - 6 && lum[y * w + x] > thr) pts.push([x, y]);
        }
      {
        const key = (x, y) => y * 4096 + x;
        const set = new Set(pts.map(([x, y]) => key(x, y)));
        let bestComp = [];
        while (set.size > 0) {
          const first = set.values().next().value;
          set.delete(first);
          const stack = [first];
          const comp = [];
          while (stack.length > 0) {
            const k = stack.pop();
            const x = k % 4096;
            const y = (k - x) / 4096;
            comp.push([x, y]);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const q = key(x + dx, y + dy);
              if (set.has(q)) {
                set.delete(q);
                stack.push(q);
              }
            }
          }
          if (comp.length > bestComp.length) bestComp = comp;
        }
        pts.length = 0;
        pts.push(...bestComp);
      }
      // Max Feret diameter over 36 directions (a partly lit disk still spans its full diameter along the terminator).
      let feret = 0;
      let minFeret = Infinity;
      for (let a = 0; a < 180; a += 5) {
        const c = Math.cos(a * DEG);
        const s2 = Math.sin(a * DEG);
        let lo = Infinity;
        let hi = -Infinity;
        for (const [x, y] of pts) {
          const t = x * c + y * s2;
          if (t < lo) lo = t;
          if (t > hi) hi = t;
        }
        const d = hi - lo + 1;
        if (d > feret) feret = d;
        if (d < minFeret) minFeret = d;
      }
      const pxPerDeg = (e.pxPerDegV + e.pxPerDegH) / 2;
      const r = { label, centrePx: [cx, cy], visible: e.c.visible, skyLuma: fx(sky, 1), peakLuma: fx(peak, 1), litPx: pts.length, maxFeretPx: fx(feret, 1), minFeretPx: fx(minFeret, 1), pxPerDegAtEarth: fx(pxPerDeg, 2), diameterDeg: fx(feret / pxPerDeg, 2) };
      writePng(path.join(out, `vt14-earth-${label}-3x-${tag}.png`), crop(img, cx - 80, cy - 80, 160, 160, 3));
      console.log("earth", JSON.stringify(r));
      return r;
    };
    result.earth = [await measureEarth(`corner-shipped-${state.earthDiameterDeg}deg`, frame)];
    // Same Earth on the optical axis (the VT's 39 px assumes the screen centre: 16.3 px per degree at 1080p, vFOV 60).
    const camP = await page.evaluate(() => window.__vx.roots.camera.position.toArray());
    const ed = [Math.cos(state.earthElevationDeg * DEG) * Math.cos(state.earthAzimuthDeg * DEG), Math.sin(state.earthElevationDeg * DEG), Math.cos(state.earthElevationDeg * DEG) * Math.sin(state.earthAzimuthDeg * DEG)];
    await setPose(page, { position: camP, target: [camP[0] + ed[0] * 100, camP[1] + ed[1] * 100, camP[2] + ed[2] * 100] });
    const centred = await grab(page, { settle: Math.max(settle, 4), file: path.join(out, `vt14-earth-centred-${tag}.png`) });
    result.earth.push(await measureEarth(`centre-shipped-${state.earthDiameterDeg}deg`, centred));
    await page.evaluate(() => window.__mcLook.set({ earthDiameterDeg: 2.4 }));
    const small = await grab(page, { settle: Math.max(settle, 4) });
    result.earth.push(await measureEarth("centre-2.4deg", small));
  }
  result.s01Errors = errors;
  await page.close();
}

if (todo.includes("stars")) {
  const { page, errors } = await openPage(browser, `scene=s06&view=wide&preset=${preset}&backend=${backend}&scale=1`);
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
  const first = await snap(path.join(out, `vt13-s06-pan-first-${tag}.png`));
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
  for (let k = 1; k <= frames; k++) {
    await setPose(page, poseAt(k));
    await step(page, 1);
    const img = await snap(k === frames ? path.join(out, `vt13-s06-pan-last-${tag}.png`) : null);
    if (k === frames) { const b = stars.find((q) => !q.lost); if (b) writePng(path.join(out, `vt13-star-moving-6x-${tag}.png`), crop(img, b.x - 16, b.y - 16, 32, 32, 6)); }
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
  if (biggest) writePng(path.join(out, `vt13-star-6x-${tag}.png`), crop(first, cands[0].x - 16, cands[0].y - 16, 32, 32, 6));
  console.log("stars", JSON.stringify({ ...result.stars, rows: undefined }));
  await page.close();
}
fs.writeFileSync(path.join(out, `sky-${todo.join("+")}-${tag}.json`), JSON.stringify(result, null, 1));
await browser.close();
