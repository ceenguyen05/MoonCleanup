// VT-M0-04b: grazing-sun shadow acne and contact gap, measured (M0-visual-checks).
//   node vt04b.mjs --out <dir> --backend webgpu|webgl2 --preset medium|high [--az 250] [--slope toward|away] [--tag flat]
//        [--suns 60,15,4,1] [--targets post,boulder,boot | slopePost,slopeBoulder,slopeBoot | none]
//        [--acne flat|rampToward|rampAway] [--macro 1] [--sweep 1] [--settle n] [--views wide,slope] [--extra "k=v&.."]
//
// Scene notes (S05): at the default azimuth 200 the ramp's raised edge shadows the flat post / boulder at 4 and 1 degrees, so
// the FLAT targets are measured at azimuth 250 (nothing up-sun of them). The SLOPE targets stand on the hinge of the ramp;
// with `slope=toward` (azimuth 200) their shadows fall up the lit 20 degree slope. With `slope=away` their shadows fall on the
// flat ground, so that run only measures acne on the ramp face, which the sun grazes (sun 25 / 22 = 6 / 3 degrees on the face).
//
// Contact gap, per sun elevation and target: three stepped captures from a side view 3 m from the contact (camera
// perpendicular to the shadow direction; VT-M0-04b "<= 3 px at 3 m"), toggled at runtime, no reload:
//   A  the shipped frame (everything casts)
//   U  nothing casts a shadow (ground truth "lit")
//   K  as U, plus a magenta emissive on every prop material -> object mask = pixels where K != U
// Along the ground line from the object's centre in the shadow direction (1 mm steps, projected with `__mcLook.project`):
//   contact edge  s_c = last object pixel on the line (mask)
//   shadow        f(s) = 1 - A / U (relative darkening), f_full = its plateau
//   shadow start  s_0 = first s > s_c with f >= 0.5 f_full        contact gap = s_0 - s_c  (cm, world)
//
// Acne, per sun elevation: |U - A| in codes inside world-space windows of open ground where NOTHING may cast a shadow
// (so any difference is self-shadowing): max, p99.9, share of pixels above 4 codes; flat ground split by camera distance
// (the three cascades).
import fs from "node:fs";
import path from "node:path";
import { launch, openPage, step, setPose, grab, info, project, parseArgs, lumaPlane, bilinear, crop, writePng, pct, fx } from "./lib.mjs";

const args = parseArgs();
const out = path.resolve(args.out ?? "out-vt04b");
fs.mkdirSync(out, { recursive: true });
const backend = args.backend ?? "webgpu";
const preset = args.preset ?? "medium";
const slope = args.slope ?? "toward";
const suns = (args.suns ?? "60,15,4,1").split(",").map(Number);
const wanted = (args.targets ?? "post,boulder,boot").split(",").filter((t) => t !== "none");
const temporal = preset === "high" || preset === "ultra";
const settle = Number(args.settle ?? (temporal ? 20 : 3));
const AZ = Number(args.az ?? 200);
const DEG = Math.PI / 180;
const tilt = (slope === "toward" ? 1 : -1) * 20 * DEG;
const tag = `${args.tag ?? "flat"}-${preset}-${backend}`;

const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return [a[0] / l, a[1] / l, a[2] / l];
  },
};
const rampPoint = (x, y, z) => [-22 + x * Math.cos(tilt) - y * Math.sin(tilt), x * Math.sin(tilt) + y * Math.cos(tilt), z];
const UP = [0, 1, 0];
const RAMP_N = [-Math.sin(tilt), Math.cos(tilt), 0];
const RAMP_X = [Math.cos(tilt), Math.sin(tilt), 0];
/** foot: scan origin on the receiving plane; n: plane normal (= the object's up); box: known half-size (m), if any. */
const TARGETS = {
  post: { foot: [0, 0, 0], n: UP, x: [1, 0, 0], box: 0.05 },
  boulder: { foot: [0, 0, 8], n: UP, x: [1, 0, 0] },
  boot: { foot: [0.12, 0, -7.95], n: UP, x: [1, 0, 0] },
  slopePost: { foot: rampPoint(0, 0, 0), n: RAMP_N, x: RAMP_X, box: 0.05 },
  slopeBoulder: { foot: rampPoint(0, 0, 8), n: RAMP_N, x: RAMP_X },
  slopeBoot: { foot: rampPoint(0.12, 0, -7.95), n: RAMP_N, x: RAMP_X },
};
const sunDir = (el) => [Math.cos(el * DEG) * Math.cos(AZ * DEG), Math.sin(el * DEG), Math.cos(el * DEG) * Math.sin(AZ * DEG)];

function frameOf(target, el) {
  const L = sunDir(el);
  const n = target.n;
  const ln = V.dot(L, n);
  if (ln <= 0.005) return null; // plane not lit
  const d = V.norm(V.add(n, V.mul(L, -1 / ln))); // direction of the shadow of an "up" segment on the plane
  let perp = V.norm(V.cross(n, d));
  if (perp[2] > 0) perp = V.mul(perp, -1);
  return { L, n, d, perp, nl: ln };
}

const browser = await launch();
const query = `scene=s05&preset=${preset}&backend=${backend}&scale=1&sun=60&az=${AZ}&view=wide&slope=${slope}${args.extra ? "&" + args.extra : ""}`;
const { page, errors, url } = await openPage(browser, query);
await page.evaluate(() => {
  const vx = window.__vx;
  vx.emissiveSaved = new Map();
  // The ramp slab shares the ground material: the mask leaves every ground material alone.
  vx.groundMaterials = new Set();
  vx.each((o) => {
    if (o.name === "mc:look-ground") vx.groundMaterials.add(o.material);
  });
  vx.mask = (on) => {
    vx.each((o) => {
      const m = o.material;
      if (!m || !m.emissive || vx.groundMaterials.has(m)) return;
      if (!vx.emissiveSaved.has(m)) vx.emissiveSaved.set(m, { c: m.emissive.clone(), i: m.emissiveIntensity });
      const s = vx.emissiveSaved.get(m);
      if (on) {
        m.emissive.setRGB(0.6, 0, 0.6);
        m.emissiveIntensity = 1;
      } else {
        m.emissive.copy(s.c);
        m.emissiveIntensity = s.i;
      }
    });
  };
});
// Optional A/B of the normal-offset rule, RUNTIME ONLY (no source edit): `--nbias <k>` replaces the shipped
// `1.1 * texel / max(sin(elevation), 0.05)` by `k * texel` on every cascade after the rig's own update.
// `--dbt <k>`: constant depth bias of k texels along the light, written to `shadow.bias` (positive = more shadow in three).
if (args.nbias || args.dbias || args.dbt) {
  await page.evaluate(async ([k, dm, dbt]) => {
    const m = await import("/src/visuals/lighting/sun-rig.ts");
    const orig = m.SunRig.prototype.update;
    m.SunRig.prototype.update = function (...a) {
      orig.apply(this, a);
      const csm = this.csm;
      if (!csm) return;
      for (let i = 0; i < csm.lights.length; i++) {
        const shadow = csm.lights[i]?.shadow;
        const texel = this.cascadeInfo[i]?.texelM;
        if (shadow && texel && k !== null) shadow.normalBias = k * texel;
        const u = this.texelUniforms?.[i];
        if (u && texel && dm !== null) u.value = texel * dm;
        if (shadow && texel && dbt !== null) shadow.bias = (dbt * texel) / (shadow.camera.far - shadow.camera.near);
      }
    };
  }, [args.nbias ? Number(args.nbias) : null, args.dbias !== undefined ? Number(args.dbias) : null, args.dbt !== undefined ? Number(args.dbt) : null]);
  await step(page, 2);
}
// Round 4: `--kernelk <k>` sets the receiver-aware kernel-height factor at run time (shadow-filter.ts `receiverKernelK`;
// 1e9 = the old square kernel).
// `--kernelku <k>`: the same for the horizontal factor (`receiverKernelKHorizontal`).
if (args.kernelk !== undefined || args.kernelku !== undefined) {
  await page.evaluate(async ([k, ku]) => {
    const m = await import("/src/visuals/lighting/shadow-filter.ts");
    if (k !== null) m.receiverKernelK.value = k;
    if (ku !== null && m.receiverKernelKHorizontal) m.receiverKernelKHorizontal.value = ku; // removed in the final code: one factor for both axes
  }, [args.kernelk !== undefined ? Number(args.kernelk) : null, args.kernelku !== undefined ? Number(args.kernelku) : null]);
  await step(page, 2);
}
// Heights of the targets (world y of the highest vertex), for the expected shadow length.
const heights = await page.evaluate(() => {
  const out = {};
  window.__vx.each((o) => {
    if (!o.isMesh || !o.geometry || !["mc:look-post", "mc:look-boulder"].includes(o.name)) return;
    o.updateWorldMatrix(true, false);
    const p = o.geometry.getAttribute("position");
    const e = o.matrixWorld.elements;
    let top = -Infinity;
    for (let i = 0; i < p.count; i++) top = Math.max(top, e[1] * p.getX(i) + e[5] * p.getY(i) + e[9] * p.getZ(i) + e[13]);
    const key = `${o.name}@${Math.round(e[12])},${Math.round(e[14])}`;
    out[key] = top;
  });
  return out;
});
const meta = await info(page);
console.log(tag, "ready", JSON.stringify(meta.look.cascades.map((c) => fx(c.texelM * 100, 2))), meta.look.postPasses.join(">"), meta.look.shadowFilter, "scale", meta.mc.renderScale);

const setSun = (el) => page.evaluate((v) => window.__mcLook.set({ sunElevationDeg: v, sunRateDegPerS: 0 }), el);
const mode = (m) => page.evaluate((v) => (window.__vx.mode(v === "real" ? "real" : "unshadowed"), window.__vx.mask(v === "mask")), m);

function maskPlane(U, K) {
  const n = U.w * U.h;
  const m = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const d = Math.max(Math.abs(U.data[j] - K.data[j]), Math.abs(U.data[j + 1] - K.data[j + 1]), Math.abs(U.data[j + 2] - K.data[j + 2]));
    m[i] = d > 5 ? 1 : 0;
  }
  return m;
}

// ---- contact gap --------------------------------------------------------------------------------------------------------
async function measure(name, target0, el, poseKind, saveBase, anchorM = 0) {
  const fr = frameOf(target0, el);
  if (fr === null) return { target: name, sun: el, pose: poseKind, note: "receiver not lit (N.L <= 0)" };
  const { d, n } = fr;
  // The scan starts `anchorM` along the shadow direction (the macro pass starts 8 cm before the contact edge of the 3 m pass).
  const target = { ...target0, foot: V.add(target0.foot, V.mul(d, anchorM)) };
  // Camera on the SHADOW side, 66 degrees above the receiving plane, looking back at the contact: the ground at the foot of a
  // vertical face is visible (a side view hides up to 1 cm of it behind the near corner of the post).
  const pose =
    poseKind === "macro"
      ? { position: V.add(V.add(target.foot, V.mul(d, 0.44)), V.mul(n, 0.7)), target: V.add(target.foot, V.mul(d, 0.14)) }
      : { position: V.add(V.add(target.foot, V.mul(d, 1.35)), V.mul(n, 2.74)), target: V.add(target.foot, V.mul(d, 0.15)) };
  await setPose(page, pose);
  await step(page, 2);
  await mode("real");
  const A = await grab(page, { settle });
  await mode("unshadowed");
  const U = await grab(page, { settle });
  await mode("mask");
  const K = await grab(page, { settle });
  await mode("real");
  const w = A.w;
  const h = A.h;
  const la = lumaPlane(A);
  const lu = lumaPlane(U);
  const mask = maskPlane(U, K);

  const S = poseKind === "macro" ? 0.6 : 1.5;
  const STEP = 0.001;
  const count = Math.round(S / STEP) + 1;
  const pts = [];
  for (let i = 0; i < count; i++) pts.push(V.add(target.foot, V.add(V.mul(d, i * STEP), V.mul(n, 0.001))));
  const px = await project(page, pts);
  const prof = [];
  for (let i = 0; i < count; i++) {
    const p = px[i];
    if (!p.visible || p.x < 1 || p.y < 1 || p.x > w - 2 || p.y > h - 2) {
      prof.push(null);
      continue;
    }
    const a = bilinear(la, w, h, p.x, p.y);
    const u = bilinear(lu, w, h, p.x, p.y);
    const m = mask[Math.round(p.y) * w + Math.round(p.x)];
    prof.push({ a, u, m, f: u > 4 ? 1 - a / u : 0 });
  }
  const p10 = px[Math.round(0.1 / STEP)];
  const p20 = px[Math.round(0.2 / STEP)];
  const pxPerCm = p10 && p20 ? Math.hypot(p20.x - p10.x, p20.y - p10.y) / 10 : NaN;
  // Contact edge: last masked sample of the run that starts at the object centre (tolerating 12 mm holes).
  let sc = 0;
  let miss = 0;
  for (let i = 0; i < count; i++) {
    const q = prof[i];
    if (q === null) break;
    if (q.m) {
      sc = i;
      miss = 0;
    } else if (++miss > 12) break;
  }
  const fs_ = prof.map((q) => (q === null ? NaN : q.f));
  const after = fs_.slice(sc + 1).filter(Number.isFinite);
  const fFull = pct(after, 0.9);
  let s0 = -1;
  if (fFull > 0.12) {
    for (let i = sc + 1; i < count - 2; i++) {
      if (prof[i] === null) break;
      // 3-sample confirmation against single-pixel noise.
      if (fs_[i] >= 0.5 * fFull && fs_[i + 1] >= 0.5 * fFull && fs_[i + 2] >= 0.5 * fFull) {
        s0 = i;
        break;
      }
    }
  }
  const gapCm = s0 < 0 ? null : Math.max(0, (s0 - sc - 1) * STEP * 100);
  const shadowA = pct(prof.slice(sc + 1).filter((q) => q && q.f >= 0.8 * fFull).map((q) => q.a), 0.5);
  const litU = pct(prof.slice(sc + 1).filter(Boolean).map((q) => q.u), 0.5);
  const res = {
    target: name,
    sun: el,
    pose: poseKind,
    pxPerCm: fx(pxPerCm, 2),
    contactEdgeCm: fx((anchorM + sc * STEP) * 100, 1),
    expectedEdgeCm: target.box ? fx((target.box / Math.max(Math.abs(V.dot(d, target.x)), Math.abs(d[2]))) * 100, 1) : null,
    fFull: fx(fFull, 3),
    shadowStartCm: s0 < 0 ? null : fx((anchorM + s0 * STEP) * 100, 1),
    gapCm: gapCm === null ? null : fx(gapCm, 1),
    gapPx: gapCm === null ? null : fx(gapCm * pxPerCm, 1),
    litLuma: fx(litU, 1),
    shadowLuma: fx(shadowA, 1),
    note: s0 < 0 ? (fFull > 0.12 ? "shadow not reached on the scan" : `no shadow on the scan (f_full ${fx(fFull, 3)})`) : "",
  };
  if (saveBase) {
    const c = px[Math.min(count - 1, sc + 50)] ?? px[0];
    const cw = poseKind === "macro" ? 640 : 480;
    const ch = poseKind === "macro" ? 400 : 300;
    res.crop = crop(A, c.x - cw / 2, c.y - ch * 0.6, cw, ch);
    writePng(`${saveBase}.png`, res.crop);
  }
  return res;
}

// ---- shadow length ------------------------------------------------------------------------------------------------------
// Camera near the object looking along its shadow (a third-person distance, so the shadow runs through the cascades as in
// play). Shadow run = from the contact to the first sample where the darkening falls below half its plateau.
async function tip(name, target, el) {
  const fr = frameOf(target, el);
  if (fr === null) return null;
  const { d, perp, n } = fr;
  const h = name === "post" ? 1 : (heights["mc:look-boulder@0,8"] ?? 0.4);
  const expected = h / Math.tan(el * DEG) + (name === "post" ? 0.05 : 0);
  const reach = Math.min(expected * 1.35 + 1, 40);
  await setPose(page, { position: V.add(V.add(V.add(target.foot, V.mul(d, -3)), V.mul(perp, 1.2)), V.mul(n, 2.2)), target: V.add(target.foot, V.mul(d, Math.min(reach * 0.5, 9))) });
  await step(page, 2);
  await mode("real");
  const A = await grab(page, { settle, file: path.join(out, `tip-${name}-sun${el}-${tag}.png`) });
  await mode("unshadowed");
  const U = await grab(page, { settle });
  await mode("mask");
  const K = await grab(page, { settle });
  await mode("real");
  const la = lumaPlane(A);
  const lu = lumaPlane(U);
  // Convex object (post, rock): nothing may shadow its lit faces, so every object pixel darker in A than in U is a
  // false self-shadow of the bias rule.
  const mk = maskPlane(U, K);
  const c0 = (await project(page, [V.add(target.foot, V.mul(n, h * 0.5))]))[0];
  let objN = 0;
  let objDark = 0;
  let objLoss = 0;
  const R = 260;
  for (let y = Math.max(0, Math.round(c0.y - R)); y < Math.min(A.h, Math.round(c0.y + R)); y++)
    for (let x = Math.max(0, Math.round(c0.x - R)); x < Math.min(A.w, Math.round(c0.x + R)); x++) {
      const i = y * A.w + x;
      if (!mk[i] || lu[i] < 30) continue;
      objN++;
      const dd = lu[i] - la[i];
      if (dd > 4) {
        objDark++;
        objLoss += dd;
      }
    }
  // Ground on the SUN side of the object: must be fully lit.
  const sunPts = [];
  for (let sM = 0.08 + (name === "post" ? 0 : 0.5); sM <= 2.2; sM += 0.01) sunPts.push(V.add(target.foot, V.add(V.mul(d, -sM), V.mul(n, 0.002))));
  const sunPx = await project(page, sunPts);
  let sunward = 0;
  for (const p of sunPx) {
    if (!p.visible || p.x < 1 || p.y < 1 || p.x > A.w - 2 || p.y > A.h - 2) continue;
    if (mk[Math.round(p.y) * A.w + Math.round(p.x)]) continue;
    const u = bilinear(lu, A.w, A.h, p.x, p.y);
    if (u > 8 && 1 - bilinear(la, A.w, A.h, p.x, p.y) / u > 0.15) sunward++;
  }
  const STEP = 0.02;
  const start = name === "post" ? 0.12 : 0.6;
  const pts = [];
  for (let sM = start; sM <= reach; sM += STEP) pts.push(V.add(target.foot, V.add(V.mul(d, sM), V.mul(n, 0.002))));
  const px = await project(page, pts);
  const f = px.map((p) => (p.visible && p.x > 1 && p.y > 1 && p.x < A.w - 2 && p.y < A.h - 2 ? (() => { const u = bilinear(lu, A.w, A.h, p.x, p.y); return u > 4 ? 1 - bilinear(la, A.w, A.h, p.x, p.y) / u : 0; })() : NaN));
  const valid = f.filter(Number.isFinite);
  const fFull = pct(valid, 0.95);
  let runEnd = null;
  let last = null;
  if (fFull > 0.12) {
    for (let i = 0; i < f.length; i++) {
      if (!Number.isFinite(f[i])) continue;
      if (f[i] >= 0.5 * fFull) last = start + i * STEP;
      else if (runEnd === null && i > 0) runEnd = start + i * STEP;
    }
    if (f[0] < 0.5 * fFull) runEnd = start; // not shadowed even at the first sample past the contact
  }
  const r = { target: name, sun: el, heightM: fx(h, 2), expectedM: fx(expected, 2), scannedToM: fx(reach, 1), fFull: fx(fFull, 3), attachedRunEndM: fFull > 0.12 ? fx(runEnd ?? reach, 2) : 0, lastShadowedM: last === null ? 0 : fx(last, 2), objectLitPx: objN, objectFalseShadowShare: fx(objN ? objDark / objN : 0, 4), objectMeanLossCodes: fx(objDark ? objLoss / objDark : 0, 1), sunwardFalseShadowCm: sunward };
  r.attachedShare = fx(Math.min(r.attachedRunEndM, expected) / expected, 2);
  console.log("tip", JSON.stringify(r));
  return r;
}

// ---- acne in clean windows -------------------------------------------------------------------------------------------
function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function acneViews() {
  if (args.acne === "flat") {
    // Open flat ground up-sun of every object (azimuth 250: the sun is toward -z), seen from z = -130 looking +z.
    const band = (name, z0, z1) => ({ name, quad: [[-25, 0.002, z0], [25, 0.002, z0], [25, 0.002, z1], [-25, 0.002, z1]] });
    return [
      { pose: { position: [0, 1.7, -130], target: [0, 0.6, -90] }, id: "eye", windows: [band("2-10 m", -128, -120), band("10-40 m", -120, -90), band("40-116 m", -90, -14)] },
      { pose: { position: [0, 12, -130], target: [0, 0, -75] }, id: "high", windows: [band("12-40 m", -118, -90), band("40-116 m", -90, -14)] },
    ];
  }
  if (args.acne === "rampToward" || args.acne === "rampAway") {
    const [x0, x1, z0, z1] = args.acne === "rampToward" ? [0.6, 6.5, -10.8, -8.9] : [-6.5, -1.5, -10.5, -2.5];
    const c = rampPoint((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const lift = (x, z) => V.add(rampPoint(x, 0, z), V.mul(RAMP_N, 0.002));
    return [
      {
        pose: { position: V.add(V.add(c, V.mul(RAMP_N, 2.2)), [0, 0, -4.5]), target: c },
        id: "ramp",
        windows: [{ name: "ramp face", quad: [lift(x0, z0), lift(x1, z0), lift(x1, z1), lift(x0, z1)] }],
      },
    ];
  }
  return [];
}
async function acne(el) {
  const outRows = [];
  for (const view of acneViews()) {
    await setPose(page, view.pose);
    await step(page, 2);
    await mode("real");
    const A = await grab(page, { settle, file: path.join(out, `acne-${view.id}-sun${el}-${tag}.png`) });
    await mode("unshadowed");
    const U = await grab(page, { settle });
    const U2 = args.control === "1" ? await grab(page, { settle }) : null;
    await mode("real");
    const w = A.w;
    const h = A.h;
    const la = lumaPlane(A);
    const lu = lumaPlane(U);
    const lu2 = U2 ? lumaPlane(U2) : null;
    const heat = { w, h, data: new Uint8Array(w * h * 4) };
    for (let i = 0; i < w * h; i++) {
      heat.data[i * 4] = Math.min(255, Math.abs(lu[i] - la[i]) * 16);
      heat.data[i * 4 + 3] = 255;
    }
    let worst = 0;
    for (const win of view.windows) {
      const poly = await project(page, win.quad);
      const xs = poly.map((p) => p.x);
      const ys = poly.map((p) => p.y);
      const bx0 = Math.max(0, Math.floor(Math.min(...xs)));
      const bx1 = Math.min(w - 1, Math.ceil(Math.max(...xs)));
      const by0 = Math.max(0, Math.floor(Math.min(...ys)));
      const by1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
      const diffs = [];
      const cdiffs = [];
      let cOver4 = 0;
      let n = 0;
      let over4 = 0;
      let maxD = 0;
      let sumU = 0;
      let sumA = 0;
      for (let y = by0; y <= by1; y++)
        for (let x = bx0; x <= bx1; x++) {
          if (!inPoly(x + 0.5, y + 0.5, poly)) continue;
          const i = y * w + x;
          const dd = Math.abs(lu[i] - la[i]);
          n++;
          sumU += lu[i];
          sumA += la[i];
          if (dd > 4) over4++;
          if (dd > maxD) maxD = dd;
          diffs.push(dd);
          if (lu2) {
            const cd = Math.abs(lu[i] - lu2[i]);
            cdiffs.push(cd);
            if (cd > 4) cOver4++;
          }
          heat.data[i * 4 + 2] = 70;
        }
      const row = {
        sun: el,
        view: view.id,
        window: win.name,
        px: n,
        litLuma: fx(sumU / Math.max(1, n), 1),
        shippedLuma: fx(sumA / Math.max(1, n), 1),
        over4Px: over4,
        over4Share: fx(n ? over4 / n : 0, 5),
        max: fx(maxD, 1),
        p999: fx(pct(diffs, 0.999), 2),
        p99: fx(pct(diffs, 0.99), 2),
        ...(lu2 ? { controlOver4Share: fx(n ? cOver4 / n : 0, 5), controlP99: fx(pct(cdiffs, 0.99), 2), controlMax: fx(Math.max(0, ...cdiffs.filter((_, q) => q % 4 === 0)), 1) } : {}),
      };
      worst = Math.max(worst, row.over4Share ?? 0);
      outRows.push(row);
      console.log("acne", JSON.stringify(row));
    }
    if (worst > 0.0005) writePng(path.join(out, `acne-${view.id}-sun${el}-${tag}-heat.png`), heat);
  }
  return outRows;
}

const rows = [];
const acneRows = [];
const tipRows = [];
const sheet = []; // [sunIndex][targetIndex] crops for the contact sheet
for (const el of suns) {
  await setSun(el);
  await setPose(page, null);
  // Named views of the shipped look (full frames) for the look record.
  for (const view of (args.views ?? "wide").split(",").filter((v) => v !== "none")) {
    await page.evaluate((v) => window.__mcLook.setView(v), view);
    await grab(page, { settle: Math.max(settle, 3), file: path.join(out, `view-${view}-sun${el}-${tag}.png`) });
  }
  const line = [];
  for (const name of wanted) {
    const target = TARGETS[name];
    const r = await measure(name, target, el, "3m", path.join(out, `contact-${name}-sun${el}-${tag}`));
    line.push(r.crop ?? null);
    delete r.crop;
    rows.push(r);
    console.log(JSON.stringify(r));
    if (args.macro === "1" && !r.note?.startsWith("receiver")) {
      const m = await measure(name, target, el, "macro", path.join(out, `macro-${name}-sun${el}-${tag}`), Math.max(0, r.contactEdgeCm / 100 - 0.08));
      delete m.crop;
      rows.push(m);
      console.log(JSON.stringify(m));
    }
  }
  sheet.push(line);
  if (args.tip === "1") for (const name of ["post", "boulder"]) tipRows.push(await tip(name, TARGETS[name], el));
  acneRows.push(...(await acne(el)));
}

// Sun sweep: 0.1 deg per step for 10 steps (the VT's 0.1 deg/s for 10 s), post foot from the 3 m view.
const sweep = [];
if (args.sweep === "1") {
  for (const start of [4, 1]) {
    const seq = [];
    for (let k = 0; k <= 10; k++) {
      const el = start + k * 0.1;
      await setSun(el);
      const r = await measure(wanted[0], TARGETS[wanted[0]], el, "3m", null);
      seq.push({ sun: fx(el, 1), gapCm: r.gapCm, shadowStartCm: r.shadowStartCm, fFull: r.fFull });
    }
    sweep.push({ start, target: wanted[0], seq });
    console.log("sweep", start, JSON.stringify(seq.map((s) => s.gapCm)));
  }
}

// Contact sheet: rows = suns, columns = targets, native pixels (no scaling).
if (wanted.length > 0) {
  const cw = 480;
  const ch = 300;
  const W = cw * wanted.length;
  const H = ch * suns.length;
  const img = { w: W, h: H, data: new Uint8Array(W * H * 4).fill(255) };
  sheet.forEach((line, r) =>
    line.forEach((c, k) => {
      if (!c) return;
      for (let y = 0; y < ch; y++) img.data.set(c.data.subarray(y * cw * 4, (y + 1) * cw * 4), ((r * ch + y) * W + k * cw) * 4);
    }),
  );
  writePng(path.join(out, `sheet-${tag}.png`), img);
}
fs.writeFileSync(path.join(out, `vt04b-${tag}.json`), JSON.stringify({ url, meta, az: AZ, slope, suns, targets: wanted, nbias: args.nbias ?? "shipped", dbias: args.dbias ?? "shipped", dbt: args.dbt ?? "source", heights, rows, tips: tipRows, acne: acneRows, sweep, errors }, null, 1));
console.log(tag, "errors", errors.length, errors.slice(0, 3));
await browser.close();
