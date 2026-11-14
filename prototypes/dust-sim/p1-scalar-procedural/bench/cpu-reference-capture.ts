// CPU reference render of the P1 dust model at the harness bookmarks. NOT the GPU path and not a contest capture:
// a smooth sphere, Lambert light, the WDS 7.7 albedo pair (clean 0.34, grime 0.085) and the P1 dust mask (dissolve from
// L0, times the local ring). It exists so the look of non-persistent trails can be judged before a renderer exists,
// and to measure the edge width the model itself produces. Run from tools/bots with Node 26:
//   node --import tsx ../../prototypes/dust-sim/p1-scalar-procedural/bench/cpu-reference-capture.ts [outDir] [width] [height]
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import type { PlotId, StrokeRecord } from "@moon-cleanup/shared";
import { createStrokeSource, DEFAULT_STROKE_SOURCE } from "../../../../tools/bots/src/scenarios/dust-contest/index";
import { HARNESS_SEED, makeBookmarks, sceneSetupStrokes, sitePoint } from "../../harness/src/scene";
import type { CameraPose } from "../../harness/src/types";
import { createGrid } from "../grid";
import { P1Client } from "../src/client";
import { DetailRing, RING_PRESETS } from "../src/ring";
import { P1Server, type MessageSink } from "../src/server";
import { Dissolve, plotSeed } from "../src/visual";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(process.argv[2] ?? path.join(here, "../results/cpu-reference"));
const W = Number(process.argv[3] ?? 1280);
const H = Number(process.argv[4] ?? 720);
const R = 2000;
const VFOV = (60 * Math.PI) / 180;
const CLEAN = 0.34;
const GRIME = 0.085;
const TAU = 0.08;

class Dir {
  x = 1;
  y = 0;
  z = 0;
}

const grid = createGrid();
const server = new P1Server({ plotCount: grid.params.plotCount, radiusM: R, simTickHz: 20 });
const client = new P1Client(grid.params.plotCount);
const sink: MessageSink = (b, n) => {
  client.receive(b, n);
};
const dissolve = new Dissolve();
const ring = new DetailRing(RING_PRESETS.medium.size, RING_PRESETS.medium.texelMm, R);

// World: 16 bots clean around the site for 120 s (seen only as L0: nobody's ring holds their trails), then the viewer
// sweeps the reference strip with the ring centred on its middle.
const site = sitePoint(0, 0);
const scratch = new Dir();
scratch.x = site[0];
scratch.y = site[1];
scratch.z = site[2];
const clusterPlot = grid.plotAt(scratch);
const bots = Array.from({ length: 16 }, (_, i) =>
  createStrokeSource(grid, { ...DEFAULT_STROKE_SOURCE, seed: HARNESS_SEED, botIndex: i, clusterPlot, actorSlot: i }),
);
for (let t = 1; t <= 2400; t++) {
  for (const next of bots) server.submitStroke(next(t), sink);
  server.step(sink);
}
const mid = sitePoint(0, 20);
ring.centerOn(mid[0], mid[1], mid[2]);
const setup = sceneSetupStrokes(grid);
for (const s of setup) {
  server.submitStroke({ ...s, tick: (s.tick + 10_000) as StrokeRecord["tick"] }, sink);
  ring.drawStroke(grid.frame(s.anchor), s, 1);
}
server.flushPlots(sink);
if (client.hash[0] !== server.hash[0]) throw new Error("client mirror diverged");

/** Presence mask of the last dustOpacity() call (the crisp part of the edge, before progressive thinning). */
const lastMask = new Float64Array(1);

/** Dust opacity t (0 clean .. 1 full grime) at a unit direction; `useRing` false is the late-joiner view. */
function dustOpacity(d: Dir, hint: number, useRing: boolean, softness: number, out: Int32Array): number {
  const plot = grid.plotAt(d, hint as PlotId);
  out[0] = plot;
  const frac = client.fracOf(plot);
  let remaining = dissolve.coverage(d.x * R, d.y * R, d.z * R, frac, plotSeed(plot), softness);
  if (useRing) remaining *= 1 - ring.sweptBilinearAt(d.x, d.y, d.z);
  // Presence mask and progressive thinning of WDS 7.7.
  const w = 0.04;
  let m = (remaining - (TAU - w)) / (2 * w);
  m = m < 0 ? 0 : m > 1 ? 1 : m;
  m = m * m * (3 - 2 * m);
  lastMask[0] = m;
  return m * (0.35 + 0.65 * remaining);
}

interface Camera {
  o: readonly number[];
  f: number[];
  r: number[];
  u: number[];
  tan: number;
}
const cross = (a: readonly number[], b: readonly number[]): number[] => [
  (a[1] ?? 0) * (b[2] ?? 0) - (a[2] ?? 0) * (b[1] ?? 0),
  (a[2] ?? 0) * (b[0] ?? 0) - (a[0] ?? 0) * (b[2] ?? 0),
  (a[0] ?? 0) * (b[1] ?? 0) - (a[1] ?? 0) * (b[0] ?? 0),
];
const unit = (a: readonly number[]): number[] => {
  const l = Math.hypot(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0) || 1;
  return [(a[0] ?? 0) / l, (a[1] ?? 0) / l, (a[2] ?? 0) / l];
};
function camera(pose: CameraPose): Camera {
  const f = unit(pose.forward);
  const r = unit(cross(f, pose.up));
  return { o: pose.position, f, r, u: cross(r, f), tan: Math.tan(VFOV / 2) };
}

/** Ray through screen point (sx, sy in pixels of a w x h image) to the sphere; false when it misses. */
function hit(c: Camera, sx: number, sy: number, w: number, h: number, out: Dir): boolean {
  const px = ((2 * sx) / w - 1) * c.tan * (w / h);
  const py = (1 - (2 * sy) / h) * c.tan;
  const d = unit([0, 1, 2].map((k) => (c.f[k] ?? 0) + px * (c.r[k] ?? 0) + py * (c.u[k] ?? 0)));
  const [ox = 0, oy = 0, oz = 0] = c.o;
  const [dx = 0, dy = 0, dz = 0] = d;
  const b = ox * dx + oy * dy + oz * dz;
  const disc = b * b - (ox * ox + oy * oy + oz * oz - R * R);
  if (disc < 0) return false;
  const t = -b - Math.sqrt(disc);
  if (t <= 0) return false;
  out.x = (ox + t * dx) / R;
  out.y = (oy + t * dy) / R;
  out.z = (oz + t * dz) / R;
  return true;
}

function png(rgb: Uint8Array, w: number, h: number): Uint8Array {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const body = new Uint8Array(4 + data.length);
    body.set(Buffer.from(type, "ascii"), 0);
    body.set(data, 4);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.set(body, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

function render(pose: CameraPose, useRing: boolean): Uint8Array {
  const c = camera(pose);
  const rgb = new Uint8Array(W * H * 3);
  const d = new Dir();
  const plotOut = new Int32Array(1);
  let hint = clusterPlot as number;
  const SS = 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let s = 0; s < SS * SS; s++) {
        const sx = x + ((s % SS) + 0.5) / SS;
        const sy = y + (Math.floor(s / SS) + 0.5) / SS;
        if (!hit(c, sx, sy, W, H, d)) continue;
        const t = dustOpacity(d, hint, useRing, 0.03, plotOut);
        hint = plotOut[0] ?? hint;
        sum += CLEAN + (GRIME - CLEAN) * t;
      }
      // Exposure puts clean ground at 0.8 linear; the sun only scales the whole frame on a smooth sphere.
      const v = Math.min(1, ((sum / (SS * SS)) * 0.8) / CLEAN) ** (1 / 2.2);
      const g = Math.round(v * 255);
      const i = (y * W + x) * 3;
      rgb[i] = g;
      rgb[i + 1] = g;
      rgb[i + 2] = Math.round(g * 0.97);
    }
  }
  return rgb;
}

/**
 * Edge width in pixels of a 1920 x 1080 frame at a bookmark that looks at the strip's west edge: per column, the
 * distance between the 10 % and 90 % crossings going from the strip outwards; median of 9 columns. `mask` true
 * measures the presence mask alone, false the full dust opacity (mask x thinning). The model edge is evaluated without
 * pixel integration, so anything below one pixel is reported as 1.
 */
function edgeWidthPx(pose: CameraPose, mask: boolean): number | null {
  const c = camera(pose);
  const d = new Dir();
  const plotOut = new Int32Array(1);
  const widths: number[] = [];
  const SUB = 16;
  for (let col = 0; col < 9; col++) {
    const sx = 960 + (col - 4) * 12;
    const profile: number[] = [];
    for (let k = 0; k < 1080 * SUB; k++) {
      if (!hit(c, sx, (k + 0.5) / SUB, 1920, 1080, d)) {
        profile.push(-1);
        continue;
      }
      const t = dustOpacity(d, clusterPlot, true, 0.03, plotOut);
      profile.push(mask ? (lastMask[0] ?? 0) : t);
    }
    // The view centre sits on the edge. Up the screen is the clean strip, down the screen the dust in front of it:
    // find a clean start just above the centre, then walk down into the dust.
    let k = (540 - 4) * SUB;
    for (let guard = 0; guard < 60 * SUB && k > 0 && (profile[k] ?? 1) > 0.05; guard++) k--;
    if ((profile[k] ?? 1) > 0.05 || (profile[k] ?? -1) < 0) continue;
    let lo = -1;
    let hi = -1;
    for (let j = k; j < profile.length; j++) {
      const v = profile[j] ?? 0;
      if (lo < 0 && v >= 0.1) lo = j;
      if (v >= 0.9) {
        hi = j;
        break;
      }
    }
    if (lo >= 0 && hi >= 0) widths.push(Math.max(1, (hi - lo) / SUB));
  }
  if (widths.length < 5) return null;
  widths.sort((a, b) => a - b);
  return widths[widths.length >> 1] ?? null;
}

mkdirSync(outDir, { recursive: true });
const report: Record<string, number | null> = {};
for (const mark of makeBookmarks()) {
  const t0 = performance.now();
  writeFileSync(path.join(outDir, `${mark.id}.png`), png(render(mark.pose, true), W, H));
  if (mark.purpose === "edge") {
    writeFileSync(path.join(outDir, `${mark.id}.late-join.png`), png(render(mark.pose, false), W, H));
    report[`edgeWidthPx.opacity.${mark.id}`] = edgeWidthPx(mark.pose, false);
    report[`edgeWidthPx.mask.${mark.id}`] = edgeWidthPx(mark.pose, true);
  }
  console.log(mark.id, `${(performance.now() - t0).toFixed(0)} ms`);
}
report.plotsNonDefault = server.nonDefaultCount;
writeFileSync(path.join(outDir, "cpu-reference.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
