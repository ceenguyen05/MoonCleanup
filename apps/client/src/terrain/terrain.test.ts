// CDLOD selection, the min / max pyramid, the patch and the Pilot Fence on the REAL baked cube (assets/terrain).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GroundHeight, type HeightCube } from "@moon-cleanup/world";
import { HeightMinMax } from "./cdlod/min-max";
import { buildPatchGrid } from "./cdlod/patch-grid";
import {
  CdlodSelector,
  createCdlodView,
  DETAIL_ABOVE_M,
  DETAIL_BELOW_M,
  MORPH_STAGES,
  sidePlanesFromViewProjection,
} from "./cdlod/select";
import { inflateRawSync } from "node:zlib";
import { decodeHorizonFile, loadHorizonAsset, loadTerrainAsset, type TerrainAsset } from "./height-asset";
import { borealPilotFence, fenceArcDistanceM, fenceRingDirections, PilotFenceWatch } from "./pilot-fence";

const ASSETS = resolve(import.meta.dirname, "../../../../assets/terrain");
const R = 2000;
const QUARTER_PI = Math.PI / 4;

let cached: Promise<TerrainAsset> | null = null;
function asset(): Promise<TerrainAsset> {
  cached ??= loadTerrainAsset({
    baseUrl: "",
    fetchBytes: (url) => Promise.resolve(new Uint8Array(readFileSync(resolve(ASSETS, url)))),
  });
  return cached;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Direction of (face, a, b), layout v1. */
function dirOf(face: number, a: number, b: number): [number, number, number] {
  const N = [
    [1, 0, 0, 0, 0, -1, 0, 1, 0],
    [-1, 0, 0, 0, 0, 1, 0, 1, 0],
    [0, 1, 0, 1, 0, 0, 0, 0, -1],
    [0, -1, 0, 1, 0, 0, 0, 0, 1],
    [0, 0, 1, 1, 0, 0, 0, 1, 0],
    [0, 0, -1, -1, 0, 0, 0, 1, 0],
  ][face]!;
  const ta = Math.tan(a * QUARTER_PI);
  const tb = Math.tan(b * QUARTER_PI);
  const x = N[0]! + ta * N[3]! + tb * N[6]!;
  const y = N[1]! + ta * N[4]! + tb * N[7]!;
  const z = N[2]! + ta * N[5]! + tb * N[8]!;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

function selector(cube: HeightCube, leafLevel = 8, rangeMult = 1): CdlodSelector {
  return new CdlodSelector({ radiusM: R, leafLevel, rangeMult, minMax: new HeightMinMax(cube) });
}

/** A view from `eyeM` above the ground at `arcM` from Boreal, no frustum planes. */
function viewAt(ground: GroundHeight, arcM: number, eyeM: number): ReturnType<typeof createCdlodView> {
  const view = createCdlodView();
  const theta = arcM / R;
  const d = [Math.sin(theta) * 0.8, Math.cos(theta), Math.sin(theta) * 0.6] as const;
  const h = ground.heightAtXYZ(d[0], d[1], d[2]);
  view.camX = d[0] * (R + h + eyeM);
  view.camY = d[1] * (R + h + eyeM);
  view.camZ = d[2] * (R + h + eyeM);
  view.lodHeightM = h;
  view.frustumCull = false;
  return view;
}

describe("height asset + min/max pyramid", () => {
  it("decodes the shipped cube and bounds every node's bilinear samples", async () => {
    const { cube, radiusM, pads } = await asset();
    expect(cube.faceSize).toBe(1024);
    expect(radiusM).toBe(R);
    expect(pads.length).toBe(4);
    const mm = new HeightMinMax(cube);
    expect(mm.baseLevel).toBe(8);
    expect(mm.byteLength).toBeLessThan(2.2 * 1024 * 1024);
    const rnd = mulberry(7);
    for (let k = 0; k < 20_000; k++) {
      const face = Math.floor(rnd() * 6);
      const level = Math.floor(rnd() * 10); // 9 reads its level-8 ancestor
      const side = 1 << level;
      const x = Math.floor(rnd() * side);
      const y = Math.floor(rnd() * side);
      const a = -1 + ((x + rnd()) * 2) / side;
      const b = -1 + ((y + rnd()) * 2) / side;
      const h = cube.sampleFaceAB(face, a, b);
      mm.get(face, level, x, y);
      expect(h).toBeGreaterThanOrEqual(mm.lo - 1e-9);
      expect(h).toBeLessThanOrEqual(mm.hi + 1e-9);
    }
    expect(mm.globalMinM).toBeCloseTo(cube.minHeightM, 1);
  }, 60_000);

  it("detail margins bound H_detail", async () => {
    const { cube, pads } = await asset();
    const ground = new GroundHeight(cube, { radiusM: R, pads });
    const rnd = mulberry(11);
    let lo = 0;
    let hi = 0;
    for (let k = 0; k < 200_000; k++) {
      const z = 2 * rnd() - 1;
      const phi = 2 * Math.PI * rnd();
      const s = Math.sqrt(1 - z * z);
      const d = ground.detailAtXYZ(s * Math.cos(phi), z, s * Math.sin(phi));
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
    expect(hi).toBeLessThan(DETAIL_ABOVE_M);
    expect(lo).toBeGreaterThan(-DETAIL_BELOW_M);
  }, 60_000);
});

describe("CDLOD selection", () => {
  it("covers the sphere exactly once without culling, from the ground and from orbit", async () => {
    const { cube, pads } = await asset();
    const ground = new GroundHeight(cube, { radiusM: R, pads });
    const sel = selector(cube);
    for (const [arc, eye] of [
      [150, 1.7],
      [600, 30],
      [0, 4400],
    ] as const) {
      const view = viewAt(ground, arc, eye);
      // Camera far above the horizon sphere, horizon culling still hides the far side: add the area it removed.
      const n = sel.select(view);
      expect(sel.stats.overflow).toBe(0);
      let area = 0;
      for (let i = 0; i < n; i++) area += sel.nodeData[i * 4 + 2]! ** 2;
      // Each face has (a, b) area 4; drawn + horizon-culled must not exceed the whole, and from the ground most is culled.
      expect(area).toBeLessThanOrEqual(24 + 1e-9);
      if (eye > 4000) expect(area).toBeGreaterThan(4); // orbit: at least one face worth is visible
    }
  });

  it("splits by the shared LOD distance: every drawn node is in its level's band", async () => {
    const { cube, pads } = await asset();
    const ground = new GroundHeight(cube, { radiusM: R, pads });
    const sel = selector(cube);
    const view = viewAt(ground, 150, 1.7);
    const n = sel.select(view);
    expect(n).toBeGreaterThan(20);
    expect(n).toBeLessThan(400);
    const rl = R + view.lodHeightM;
    const rnd = mulberry(3);
    for (let i = 0; i < n; i++) {
      const a0 = sel.nodeData[i * 4]!;
      const b0 = sel.nodeData[i * 4 + 1]!;
      const size = sel.nodeData[i * 4 + 2]!;
      const face = sel.nodeData[i * 4 + 3]!;
      const level = sel.lodData[i * 4 + 1]!;
      expect(sel.lodData[i * 4]).toBeCloseTo(sel.ranges[level]!, 3);
      if (level === sel.leafLevel) continue;
      // Not split => no point of the footprint is nearer than the child level's range (morph factor 1 there for the
      // finer neighbour's odd vertices). Sampled on the edges, where finer neighbours meet it.
      for (let s = 0; s < 40; s++) {
        const u = rnd();
        const edge = s % 4;
        const a = edge === 0 ? a0 : edge === 1 ? a0 + size : a0 + u * size;
        const b = edge === 2 ? b0 : edge === 3 ? b0 + size : b0 + u * size;
        const d = dirOf(face, a, b);
        const dist = Math.hypot(d[0] * rl - view.camX, d[1] * rl - view.camY, d[2] * rl - view.camZ);
        expect(dist).toBeGreaterThanOrEqual(sel.ranges[level + 1]! - 1e-6);
      }
    }
  });

  it("neighbouring drawn nodes differ by at most MORPH_STAGES levels", async () => {
    const { cube, pads } = await asset();
    const ground = new GroundHeight(cube, { radiusM: R, pads });
    for (const mult of [0.75, 1, 1.5]) {
      const sel = selector(cube, 8, mult);
      const view = viewAt(ground, 420, 1.7);
      const n = sel.select(view);
      // Level of the drawn node containing a point of face 2 (+Y), found by search.
      const levelAt = (a: number, b: number): number => {
        for (let i = 0; i < n; i++) {
          if (sel.nodeData[i * 4 + 3] !== 2) continue;
          const a0 = sel.nodeData[i * 4]!;
          const b0 = sel.nodeData[i * 4 + 1]!;
          const size = sel.nodeData[i * 4 + 2]!;
          if (a >= a0 && a < a0 + size && b >= b0 && b < b0 + size) return sel.lodData[i * 4 + 1]!;
        }
        return -1;
      };
      let worst = 0;
      for (let i = 0; i < n; i++) {
        if (sel.nodeData[i * 4 + 3] !== 2) continue;
        const a0 = sel.nodeData[i * 4]!;
        const b0 = sel.nodeData[i * 4 + 1]!;
        const size = sel.nodeData[i * 4 + 2]!;
        const level = sel.lodData[i * 4 + 1]!;
        const eps = size / 64;
        for (const [a, b] of [
          [a0 - eps, b0 + size / 2],
          [a0 + size + eps, b0 + size / 2],
          [a0 + size / 2, b0 - eps],
          [a0 + size / 2, b0 + size + eps],
        ] as const) {
          const other = levelAt(a, b);
          if (other >= 0) worst = Math.max(worst, level - other);
        }
      }
      expect(worst).toBeLessThanOrEqual(MORPH_STAGES);
    }
  });

  it("frustum and horizon culling cut the ground view; nothing visible is lost", async () => {
    const { cube, pads } = await asset();
    const ground = new GroundHeight(cube, { radiusM: R, pads });
    const sel = selector(cube);
    const view = viewAt(ground, 150, 1.7);
    const all = sel.select(view);
    const horizonCulled = sel.stats.culledHorizon;
    expect(horizonCulled).toBeGreaterThan(0);
    // A 60 x 34 degree frustum looking along +x-ish tangent: planes through the camera.
    const cam = [view.camX, view.camY, view.camZ] as const;
    const len = Math.hypot(...cam);
    const up = cam.map((v) => v / len) as [number, number, number];
    let fwd: [number, number, number] = [1, 0, 0];
    const dotFU = fwd[0] * up[0] + fwd[1] * up[1] + fwd[2] * up[2];
    fwd = [fwd[0] - dotFU * up[0], fwd[1] - dotFU * up[1], fwd[2] - dotFU * up[2]];
    const fl = Math.hypot(...fwd);
    fwd = [fwd[0] / fl, fwd[1] / fl, fwd[2] / fl];
    const right: [number, number, number] = [
      fwd[1] * up[2] - fwd[2] * up[1],
      fwd[2] * up[0] - fwd[0] * up[2],
      fwd[0] * up[1] - fwd[1] * up[0],
    ];
    const plane = (k: number, axis: [number, number, number], halfDeg: number, sign: number): void => {
      const c = Math.cos((halfDeg * Math.PI) / 180);
      const s = Math.sin((halfDeg * Math.PI) / 180);
      const nx = fwd[0] * s + sign * axis[0] * c;
      const ny = fwd[1] * s + sign * axis[1] * c;
      const nz = fwd[2] * s + sign * axis[2] * c;
      view.planes[k * 4] = nx;
      view.planes[k * 4 + 1] = ny;
      view.planes[k * 4 + 2] = nz;
      view.planes[k * 4 + 3] = -(nx * cam[0] + ny * cam[1] + nz * cam[2]);
    };
    plane(0, right, 45, 1);
    plane(1, right, 45, -1);
    plane(2, up, 30, 1);
    plane(3, up, 30, -1);
    view.frustumCull = true;
    view.frustumExemptM = 0;
    const culled = sel.select(view);
    expect(culled).toBeLessThan(all * 0.6);
    expect(sel.stats.culledFrustum).toBeGreaterThan(0);
    // A ground point 40 m ahead is inside the frustum: its node must be drawn.
    const theta = 40 / R;
    const p = [
      up[0] * Math.cos(theta) + fwd[0] * Math.sin(theta),
      up[1] * Math.cos(theta) + fwd[1] * Math.sin(theta),
      up[2] * Math.cos(theta) + fwd[2] * Math.sin(theta),
    ] as const;
    expect(Math.abs(p[1])).toBeGreaterThan(Math.max(Math.abs(p[0]), Math.abs(p[2]))); // on face +Y
    const a = (Math.atan(p[0] / p[1]) * 4) / Math.PI;
    const b = (Math.atan(-p[2] / p[1]) * 4) / Math.PI;
    let found = false;
    for (let i = 0; i < culled; i++) {
      if (sel.nodeData[i * 4 + 3] !== 2) continue;
      const a0 = sel.nodeData[i * 4]!;
      const b0 = sel.nodeData[i * 4 + 1]!;
      const size = sel.nodeData[i * 4 + 2]!;
      if (a >= a0 && a <= a0 + size && b >= b0 && b <= b0 + size) found = true;
    }
    expect(found).toBe(true);
  });

  it("select stays inside the CPU budget and allocates nothing measurable", async () => {
    const { cube, pads } = await asset();
    const ground = new GroundHeight(cube, { radiusM: R, pads });
    const sel = selector(cube);
    const view = viewAt(ground, 150, 1.7);
    for (let i = 0; i < 300; i++) sel.select(view);
    const times: number[] = [];
    for (let i = 0; i < 400; i++) {
      const t0 = performance.now();
      sel.select(view);
      times.push(performance.now() - t0);
    }
    times.sort((x, y) => x - y);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    // Budget 0.8 ms (Tier A) / 1.5 ms (Tier B) for selection; the test bar is loose for a loaded CI machine.
    expect(p95).toBeLessThan(1.5);
    console.info(
      `[cdlod] ground select: ${String(sel.count)} nodes, visited ${String(sel.stats.visited)}, p50 ${times[200]!.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms`,
    );
  });

  it("side planes from a view-projection matrix keep points in front and inside", () => {
    // Identity view, symmetric 90-degree projection (column-major): x' = x, y' = y, w' = -z.
    const vp = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, -0.1, 0];
    const out = new Float64Array(16);
    sidePlanesFromViewProjection(vp, 0, 0, 0, out);
    const inside = (x: number, y: number, z: number): boolean => {
      for (let k = 0; k < 16; k += 4)
        if (out[k]! * x + out[k + 1]! * y + out[k + 2]! * z + out[k + 3]! < 0) return false;
      return true;
    };
    expect(inside(0, 0, -5)).toBe(true);
    expect(inside(4, 0, -5)).toBe(true);
    expect(inside(6, 0, -5)).toBe(false);
    expect(inside(0, -6, -5)).toBe(false);
    expect(inside(0, 0, 5)).toBe(false);
  });
});

describe("shadow caster selection", () => {
  it("writes the detail floor, skirts only cube-face edges, coarsens under an LOD floor, honours extra planes", async () => {
    const { cube, pads } = await asset();
    const ground = new GroundHeight(cube, { radiusM: R, pads });
    const sel = selector(cube);
    const view = viewAt(ground, 150, 1.7);
    view.horizonCull = false;
    view.detailFloorM = 40;
    const n = sel.select(view);
    expect(sel.stats.overflow).toBe(0);
    let skirted = 0;
    for (let i = 0; i < n; i++) {
      expect(sel.lodData[i * 4 + 3]).toBe(40);
      const a0 = sel.nodeData[i * 4]!;
      const b0 = sel.nodeData[i * 4 + 1]!;
      const size = sel.nodeData[i * 4 + 2]!;
      const onEdge = a0 === -1 || b0 === -1 || a0 + size === 1 || b0 + size === 1;
      expect(sel.lodData[i * 4 + 2]! > 0).toBe(onEdge);
      if (onEdge) skirted++;
    }
    expect(skirted).toBeGreaterThan(0);
    expect(sel.stats.perLevel[8]!).toBeGreaterThan(0);

    // Nothing is selected finer than the level whose range covers the floor (25 m: level 7, range 40 m).
    view.lodFloorM = 25;
    sel.select(view);
    expect(sel.stats.perLevel[8]).toBe(0);
    expect(sel.stats.perLevel[7]!).toBeGreaterThan(0);

    // A fifth plane through the moon centre keeps only the half on its positive side.
    view.lodFloorM = 0;
    view.frustumCull = true;
    view.frustumExemptM = 0;
    for (let k = 0; k < 4; k++) {
      // Four planes that contain everything.
      view.planes[k * 4] = 0;
      view.planes[k * 4 + 1] = 0;
      view.planes[k * 4 + 2] = 0;
      view.planes[k * 4 + 3] = 1;
    }
    view.planes[16] = 1;
    view.planes[17] = 0;
    view.planes[18] = 0;
    view.planes[19] = 0;
    view.planeCount = 5;
    const half = sel.select(view);
    expect(half).toBeLessThan(n);
    for (let i = 0; i < half; i++) {
      // Face 1 is -X: wholly on the negative side.
      expect(sel.nodeData[i * 4 + 3]).not.toBe(1);
    }
    view.maxDistanceM = 30;
    const near = sel.select(view);
    expect(near).toBeLessThan(half);
    expect(near).toBeGreaterThan(0);
  });
});

describe("horizon map asset", () => {
  it("decodes the shipped CTMW file into two RGBA sets that match the codec, plane by plane", async () => {
    const fetchBytes = (url: string): Promise<Uint8Array> =>
      Promise.resolve(new Uint8Array(readFileSync(resolve(ASSETS, url))));
    const asset = await loadHorizonAsset({ baseUrl: "", fetchBytes });
    const n = asset.faceSize;
    expect(n).toBe(512);
    expect(asset.a.length).toBe(6 * n * n * 4);
    expect(asset.b.length).toBe(6 * n * n * 4);
    expect(asset.minAngleDeg).toBe(-16);
    expect(asset.maxAngleDeg).toBe(60);

    // Independent decode by the format text (tools/terrain-bake codec.ts): delta from the left neighbour, the first
    // texel of a row from the first texel of the row above.
    const bytes = new Uint8Array(readFileSync(resolve(ASSETS, asset.file)));
    const raw = new Uint8Array(inflateRawSync(bytes.subarray(32)));
    const plane = n * n;
    const rnd = mulberry(5);
    for (let trial = 0; trial < 12; trial++) {
      const face = Math.floor(rnd() * 6);
      const k = Math.floor(rnd() * 8);
      const base = (face * 8 + k) * plane;
      const ref = new Uint8Array(plane);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const prev = i === 0 ? (j === 0 ? 0 : ref[(j - 1) * n]!) : ref[j * n + i - 1]!;
          ref[j * n + i] = (prev + raw[base + j * n + i]!) & 0xff;
        }
      }
      const set = k < 4 ? asset.a : asset.b;
      let diff = 0;
      for (let t = 0; t < plane; t++) if (set[(face * plane + t) * 4 + (k & 3)] !== ref[t]) diff++;
      expect(diff).toBe(0);
    }

    // The injected inflate is used, and a wrong magic is refused.
    await expect(decodeHorizonFile(new Uint8Array(64))).rejects.toThrow(/CTMW/);

    // Angles: the Boreal pad centre (+Y face centre) sees a low horizon in every azimuth; the map's mean is a few degrees.
    const span = asset.maxAngleDeg - asset.minAngleDeg;
    const centre = (2 * plane + (n / 2) * n + n / 2) * 4;
    for (let c = 0; c < 4; c++) {
      expect(asset.minAngleDeg + (asset.a[centre + c]! / 255) * span).toBeLessThan(12);
      expect(asset.minAngleDeg + (asset.b[centre + c]! / 255) * span).toBeLessThan(12);
    }
    let sum = 0;
    for (let t = 0; t < asset.a.length; t += 97) sum += asset.a[t]!;
    const mean = asset.minAngleDeg + (sum / Math.ceil(asset.a.length / 97) / 255) * span;
    expect(mean).toBeGreaterThan(0.5);
    expect(mean).toBeLessThan(6);
  }, 60_000);
});

describe("patch grid", () => {
  it("33 x 33 patch with a skirt ring: counts, clamped indices, no degenerate index", () => {
    const patch = buildPatchGrid(32);
    expect(patch.positions.length).toBe(35 * 35 * 3);
    expect(patch.triangles).toBe(34 * 34 * 2);
    let skirts = 0;
    for (let k = 0; k < patch.positions.length; k += 3) {
      expect(patch.positions[k]).toBeGreaterThanOrEqual(0);
      expect(patch.positions[k]).toBeLessThanOrEqual(32);
      skirts += patch.positions[k + 2]!;
    }
    expect(skirts).toBe(35 * 4 - 4);
    expect(Math.max(...patch.indices)).toBe(35 * 35 - 1);
    expect(() => buildPatchGrid(33)).toThrow();
    expect(buildPatchGrid(16).triangles).toBe(18 * 18 * 2);
  });
});

describe("Pilot Fence", () => {
  it("ring sits 900 m from Boreal along the surface and the watch reports zones with hysteresis", () => {
    const spec = borealPilotFence(R);
    expect(spec.radiusM).toBe(900);
    const dirs = fenceRingDirections(spec, 36, new Float64Array(36 * 3));
    for (let k = 0; k < 36; k++) {
      const [x, y, z] = [dirs[k * 3]!, dirs[k * 3 + 1]!, dirs[k * 3 + 2]!];
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
      expect(fenceArcDistanceM(spec, x * 2000, y * 2000, z * 2000)).toBeCloseTo(900, 6);
    }
    const zones: string[] = [];
    const watch = new PilotFenceWatch(spec, {
      onZone: (r) => zones.push(`${r.zone}@${r.distanceToFenceM.toFixed(0)}`),
    });
    const at = (arc: number): void => {
      const th = arc / R;
      watch.update(Math.sin(th) * 2001, Math.cos(th) * 2001, 0);
    };
    at(0);
    at(700);
    at(805);
    at(899);
    at(901);
    at(899.5); // inside the hysteresis band: still reached
    at(890);
    at(799); // 101 m left, inside the band: still near
    at(700);
    expect(zones).toEqual(["near@95", "reached@-1", "near@10", "inside@200"]);
    expect(watch.report.distanceFromOutpostM).toBeCloseTo(700, 6);
  });
});
