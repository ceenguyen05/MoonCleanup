// Moving-camera TRAA / SMAA smear check (M0-visual-checks; M0-W2-T02 left it NOT RUN).
//   node traa.mjs --out <dir> [--preset high] [--backend webgpu] [--scene typical] [--frames 20] [--configs traa,traa-novel,smaa]
//
// Fixed 1/60 s steps (`?capture=1`). Per configuration one page:
//   traa        the High chain as shipped (TRAA + camera-only velocity buffer)
//   traa-novel  the same chain with the velocity buffer forced to "no motion" at runtime (history is not reprojected):
//               what the terrain would do without `CameraOnlyVelocity`
//   smaa        `traa=off` (SMAA, no temporal history): the no-ghost floor
// Per path the camera moves `frames` frames at a constant speed and ends on a fixed pose; the frame of the LAST moving step
// is captured (M), then the camera holds that pose for 40 frames and the converged still is captured (S).
//   diff      |M - S| luma: mean, p99, share above 8 codes (whole frame and the ground band)
//   sharp     mean Sobel magnitude of M over S (1 = as sharp as the still, < 1 = smeared)
// The camera pose is written BEFORE the visuals update of the frame (rig, sky and velocity see the final pose).
import fs from "node:fs";
import path from "node:path";
import { launch, openPage, step, setPose, info, parseArgs, lumaPlane, decode, crop, writePng, pct, fx } from "./lib.mjs";

const args = parseArgs();
const out = path.resolve(args.out ?? "out-traa");
fs.mkdirSync(out, { recursive: true });
const preset = args.preset ?? "high";
const backend = args.backend ?? "webgpu";
const scene = args.scene ?? "typical";
const N = Number(args.frames ?? 20);
const HOLD = Number(args.hold ?? 40);
const configs = (args.configs ?? "traa,traa-novel,smaa").split(",");
const DT = 1 / 60;
const DEG = Math.PI / 180;

// End poses (the typical worksite: outpost near the origin, cleaned patch with lanes and strokes in front of it).
const END = { position: [-4.2, 1.7, -11.5], yawDeg: 20, pitchDeg: -13 };
const dirOf = (yawDeg, pitchDeg) => [Math.sin(yawDeg * DEG) * Math.cos(pitchDeg * DEG), Math.sin(pitchDeg * DEG), Math.cos(yawDeg * DEG) * Math.cos(pitchDeg * DEG)];
const poseOf = (p, yawDeg, pitchDeg) => {
  const d = dirOf(yawDeg, pitchDeg);
  return { position: p, target: [p[0] + d[0] * 10, p[1] + d[1] * 10, p[2] + d[2] * 10] };
};
/** k = frames before the end pose (0 = end). */
const PATHS = [
  ...[1.5, 5, 15].map((v) => ({
    id: `forward-${v}mps`,
    speed: `${v} m/s forward`,
    at: (k) => {
      const f = dirOf(END.yawDeg, 0);
      return poseOf([END.position[0] - f[0] * v * DT * k, END.position[1], END.position[2] - f[2] * v * DT * k], END.yawDeg, END.pitchDeg);
    },
  })),
  {
    id: "strafe-5mps",
    speed: "5 m/s sideways",
    at: (k) => {
      const r = dirOf(END.yawDeg + 90, 0);
      return poseOf([END.position[0] - r[0] * 5 * DT * k, END.position[1], END.position[2] - r[2] * 5 * DT * k], END.yawDeg, END.pitchDeg);
    },
  },
  ...[30, 90].map((w) => ({ id: `yaw-${w}dps`, speed: `${w} deg/s yaw`, at: (k) => poseOf(END.position, END.yawDeg - w * DT * k, END.pitchDeg) })),
];

function sobelMean(l, w, h, y0, y1) {
  let s = 0;
  let n = 0;
  for (let y = Math.max(1, y0); y < Math.min(h - 1, y1); y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = l[i - w + 1] + 2 * l[i + 1] + l[i + w + 1] - l[i - w - 1] - 2 * l[i - 1] - l[i + w - 1];
      const gy = l[i + w - 1] + 2 * l[i + w] + l[i + w + 1] - l[i - w - 1] - 2 * l[i - w] - l[i - w + 1];
      s += Math.hypot(gx, gy);
      n++;
    }
  return s / n;
}
function diffStats(m, s, w, h, y0, y1) {
  const d = [];
  let sum = 0;
  let over8 = 0;
  let n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = 0; x < w; x++) {
      const v = Math.abs(m[y * w + x] - s[y * w + x]);
      sum += v;
      if (v > 8) over8++;
      n++;
      if ((x & 3) === 0) d.push(v);
    }
  return { mean: fx(sum / n, 2), p99: fx(pct(d, 0.99), 1), over8Share: fx(over8 / n, 4) };
}
const shot = async (page, file) => {
  // The canvas is presented when the stepped frame's task ends; give the compositor time, then read it. No extra step.
  await page.waitForTimeout(350);
  return decode(await page.screenshot(file ? { path: file } : {}));
};

const browser = await launch();
const summary = [];
const crops = {};
for (const config of configs) {
  const knob = config === "smaa" ? "&traa=off" : "";
  const { page, errors, url } = await openPage(browser, `scene=${scene}&preset=${preset}&backend=${backend}&scale=1${knob}`);
  const meta = await info(page);
  if (config === "traa-novel") await page.evaluate(() => void (window.__vx.zeroVelocity = true));
  console.log(config, meta.look.postPasses.join(">"), "errors", errors.length);

  // Presentation check: after ONE step at a new pose the screenshot must show that pose (not the previous frame).
  let presentOk = null;
  {
    const a = PATHS[5].at(0);
    const b = PATHS[5].at(40);
    await setPose(page, a);
    await step(page, HOLD, DT);
    const sa = lumaPlane(await shot(page));
    await setPose(page, b);
    await step(page, HOLD, DT);
    const sb = lumaPlane(await shot(page));
    await setPose(page, a);
    await step(page, 1, DT);
    const one = lumaPlane(await shot(page));
    let da = 0;
    let db = 0;
    for (let i = 0; i < one.length; i += 7) {
      da += Math.abs(one[i] - sa[i]);
      db += Math.abs(one[i] - sb[i]);
    }
    presentOk = da < db;
    console.log(config, "present check: one-step frame vs new pose", fx(da / (one.length / 7), 2), "vs previous pose", fx(db / (one.length / 7), 2), presentOk ? "OK" : "STALE");
  }

  const t0 = Date.now();
  let frames = 0;
  for (const p of PATHS) {
    // Start still at the first pose so the history is valid, then move.
    await setPose(page, p.at(N));
    await step(page, 12, DT);
    for (let k = N - 1; k >= 0; k--) {
      await setPose(page, p.at(k));
      await step(page, 1, DT);
      frames++;
    }
    const M = await shot(page, path.join(out, `${p.id}-${config}-moving.png`));
    await step(page, HOLD, DT);
    frames += HOLD;
    const S = await shot(page, config === "traa" || p.id === "forward-5mps" ? path.join(out, `${p.id}-${config}-still.png`) : null);
    const w = M.w;
    const h = M.h;
    const lm = lumaPlane(M);
    const ls = lumaPlane(S);
    const groundY0 = Math.round(h * 0.55);
    const row = {
      config,
      path: p.id,
      speed: p.speed,
      frame: diffStats(lm, ls, w, h, 0, h),
      ground: diffStats(lm, ls, w, h, groundY0, h),
      sharpFrame: fx(sobelMean(lm, w, h, 0, h) / sobelMean(ls, w, h, 0, h), 3),
      sharpGround: fx(sobelMean(lm, w, h, groundY0, h) / sobelMean(ls, w, h, groundY0, h), 3),
    };
    summary.push(row);
    console.log(JSON.stringify(row));
    // 2x crops for looking: ground band centre and the horizon / prop band.
    if (p.id === "forward-5mps" || p.id === "yaw-90dps" || p.id === "strafe-5mps") {
      (crops[p.id] ??= []).push({ label: `${config}-moving`, a: crop(M, w / 2 - 240, h * 0.62, 480, 200), b: crop(M, w / 2 - 240, h * 0.3, 480, 200) });
      (crops[p.id] ??= []).push({ label: `${config}-still`, a: crop(S, w / 2 - 240, h * 0.62, 480, 200), b: crop(S, w / 2 - 240, h * 0.3, 480, 200) });
    }
  }
  console.log(config, "ms per frame about", fx((Date.now() - t0) / Math.max(1, frames), 0), "errors", errors.length, errors.slice(0, 2));
  summary.push({ config, url, passes: meta.look.postPasses, presentOk, errors });
  await page.close();
}
// Montage per path: one row per capture (config moving / still), columns = ground crop, horizon crop (native pixels).
for (const [id, list] of Object.entries(crops)) {
  const cw = 480;
  const ch = 200;
  const img = { w: cw * 2, h: ch * list.length, data: new Uint8Array(cw * 2 * ch * list.length * 4).fill(255) };
  list.forEach((c, r) => {
    for (let y = 0; y < ch; y++) {
      img.data.set(c.a.data.subarray(y * cw * 4, (y + 1) * cw * 4), ((r * ch + y) * img.w) * 4);
      img.data.set(c.b.data.subarray(y * cw * 4, (y + 1) * cw * 4), ((r * ch + y) * img.w + cw) * 4);
    }
  });
  writePng(path.join(out, `montage-${id}.png`), img);
  fs.writeFileSync(path.join(out, `montage-${id}.txt`), list.map((c, r) => `row ${r}: ${c.label}`).join("\n") + "\ncolumns: ground band crop (x centre, y 62 %), horizon band crop (y 30 %); native pixels\n");
}
fs.writeFileSync(path.join(out, `traa-${preset}-${backend}.json`), JSON.stringify({ preset, backend, scene, frames: N, hold: HOLD, end: END, summary }, null, 1));
await browser.close();
