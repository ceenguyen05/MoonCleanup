import { describe, expect, it } from "vitest";

import { sampleEquirect } from "../lola/ldem.js";
import { syntheticField } from "../testing.js";
import { goldenSamples, randomDirection, seamAgreement, seededRandom, slopeReport } from "./analysis.js";
import {
  applyPads,
  buildSlopeMetric,
  DEFAULT_PARAMS,
  GUTTER,
  quantiseCube,
  relaxSteepTexels,
  reprojectToCube,
  slopeFieldDeg,
} from "./bake.js";
import { bakeHorizon } from "./horizon.js";
import { directionFromTan, type Vec3 } from "./mapping.js";
import { sampleCubeHeight } from "./sample.js";

const params = { ...DEFAULT_PARAMS, supersample: 2 };

describe("cube reprojection (synthetic stand-in field)", () => {
  const field = syntheticField();
  const cube = reprojectToCube(field, 64, 2);

  it("reproduces the source within a small error everywhere, including across edges", () => {
    const q = quantiseCube(cube);
    const rand = seededRandom(5);
    const d: Vec3 = { x: 0, y: 0, z: 0 };
    let sq = 0;
    const count = 2000;
    for (let k = 0; k < count; k++) {
      randomDirection(rand, d);
      const e = sampleCubeHeight(q, d.x, d.y, d.z) - sampleEquirect(field, d.x, d.y, d.z);
      sq += e * e;
    }
    // 64^2 faces (49 m texels) of a field with ~100 m amplitude and few-degree wavelengths: interpolation error only.
    expect(Math.sqrt(sq / count)).toBeLessThan(1.5);
  });

  it("agrees across cube seams about as well as it agrees in the interior", () => {
    const q = quantiseCube(cube);
    const seam = seamAgreement(q, 500, 11);
    expect(seam.rmsM).toBeLessThan(1);
  });

  it("quantises to uint16 with error below half a step", () => {
    const q = quantiseCube(cube);
    let worst = 0;
    for (let i = 0; i < q.data.length; i++) {
      worst = Math.max(worst, Math.abs(q.offsetM + (q.data[i] ?? 0) * q.scaleM - (cube.data[i] ?? 0)));
    }
    expect(worst).toBeLessThanOrEqual(q.scaleM / 2 + 1e-6);
  });

  it("is deterministic on a rerun", () => {
    const again = reprojectToCube(field, 64, 2);
    expect(Buffer.from(again.data.buffer).equals(Buffer.from(cube.data.buffer))).toBe(true);
  });
});

describe("outpost pads and slope relaxation", () => {
  it("flattens pads exactly and keeps the blend ring smooth", () => {
    const n = 256;
    const cube = reprojectToCube(syntheticField(), n, 1);
    const edit = applyPads(cube, params);
    expect(edit.results).toHaveLength(4);
    const metric = buildSlopeMetric(n, params.radiusM);
    const slopes = slopeFieldDeg(cube, metric);
    const report = slopeReport(
      slopes,
      n,
      params.radiusM,
      params.sites,
      params.padRadiusM - 6,
      params.padRadiusM + params.padBlendM,
    );
    expect(report.padMaxDeg).toBeLessThan(1);
    const p = cube.padded;
    const table = new Float64Array(p);
    for (let i = 0; i < p; i++) table[i] = Math.tan(((-1 + ((i - GUTTER + 0.5) * 2) / n) * Math.PI) / 4);
    const d: Vec3 = { x: 0, y: 0, z: 0 };
    for (const site of params.sites) {
      const heights = new Set<number>();
      for (let face = 0; face < 6; face++) {
        for (let j = 0; j < p; j++) {
          for (let i = 0; i < p; i++) {
            directionFromTan(face, table[i] ?? 0, table[j] ?? 0, d);
            const dot = d.x * site.dir[0] + d.y * site.dir[1] + d.z * site.dir[2];
            const dist = Math.acos(Math.min(1, dot)) * params.radiusM;
            if (dist <= params.padRadiusM) heights.add(cube.data[face * p * p + j * p + i] ?? 0);
          }
        }
      }
      expect(heights.size).toBe(1);
    }
  });

  it("relaxes texels above the slope limit", () => {
    const n = 64;
    const cube = reprojectToCube(syntheticField(), n, 1);
    const p = cube.padded;
    for (let j = 20; j < 30; j++)
      for (let i = 30; i < 34; i++) cube.data[j * p + i] = (cube.data[j * p + i] ?? 0) + 400;
    const metric = buildSlopeMetric(n, params.radiusM);
    const before = slopeFieldDeg(cube, metric).filter((s) => s > 50).length;
    expect(before).toBeGreaterThan(0);
    const result = relaxSteepTexels(cube, metric, 50, new Uint8Array(cube.data.length));
    expect(result.texelsAboveAfter).toBe(0);
  });
});

describe("horizon and golden samples", () => {
  it("bakes an 8-azimuth map whose angles stay in range for a smooth field", () => {
    const cube = quantiseCube(reprojectToCube(syntheticField(), 32, 1));
    const { file, stats } = bakeHorizon(cube, cube.maxM, {
      faceSize: 8,
      radiusM: 2000,
      minOccluderM: 20,
      stepRatio: 1.3,
      maxDistanceM: 1500,
      minAngleDeg: -16,
      maxAngleDeg: 60,
    });
    expect(file.planes).toHaveLength(6 * 8 * 64);
    expect(stats.clampedHigh).toBe(0);
  });

  it("produces at least 20 golden directions, including corners and the pad sites", () => {
    const q = quantiseCube(reprojectToCube(syntheticField(), 32, 1));
    const samples = goldenSamples(q, params.sites, 8, 1);
    expect(samples.length).toBeGreaterThanOrEqual(20);
    expect(samples.some((s) => s.label === "outpost-boreal")).toBe(true);
    expect(samples.filter((s) => s.label.startsWith("corner-"))).toHaveLength(8);
    expect(samples.filter((s) => s.label.startsWith("edge-"))).toHaveLength(12);
  });
});
