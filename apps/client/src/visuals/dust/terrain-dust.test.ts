import { expect, it } from "vitest";
import { vec3 } from "three/tsl";
import type { PlotId } from "@moon-cleanup/shared";
import { makeScenarioLedger, scenarioGrid } from "./verify/scenario";
import { projectTerrainDustPoint, TerrainDustGround } from "./terrain-dust";

it("registers curved terrain at different heights with the flat lookup at poles and across cube faces", () => {
  const grid = scenarioGrid();
  const p = { x: 0, y: 0, z: 0 };
  for (const axis of [
    [0, 1, 0],
    [1, 0, 0],
    [0, 0, -1],
    [1, 1, 1],
    [0, -1, 0],
  ]) {
    const site = grid.plotAtXYZ(axis[0]!, axis[1]!, axis[2]!);
    for (const [u, v] of [
      [0, 0],
      [100, -100],
      [-0.15, 0.28],
      [-40, 65],
    ]) {
      grid.fromPlotLocal(site as PlotId, u! * 1000, v! * 1000, p);
      for (const height of [-30, 0, 70]) {
        const r = grid.params.radiusM + height;
        const [x, z] = projectTerrainDustPoint(grid, site, [p.x * r, p.y * r, p.z * r]);
        expect(x).toBeCloseTo(u!, 8);
        expect(z).toBeCloseTo(-v!, 8);
      }
    }
  }
}, 60_000);

it("the shader's float32 form (camToSite + camera-relative local) matches the double projection to < 1 mm", () => {
  // Twin of `regolithLayer`: D = camToSite (CPU doubles -> f32 uniform) + local (f32 camera-to-fragment), then
  // u = R (D.e) / (R + D.n), v = R (D.t) / (R + D.n), lookup (x, z) = (u, -v). Everything after the uniforms is f32.
  const f = Math.fround;
  const grid = scenarioGrid();
  const R = grid.params.radiusM;
  const p = { x: 0, y: 0, z: 0 };
  let worst = 0;
  for (const axis of [
    [0, 1, 0],
    [0.3, 0.2, -0.93],
    [1, 1, 1],
  ]) {
    const site = grid.plotAtXYZ(axis[0]!, axis[1]!, axis[2]!);
    const o = site * 3;
    const n = [0, 1, 2].map((i) => f(grid.centers[o + i]!));
    const e = [0, 1, 2].map((i) => f(grid.east[o + i]!));
    const t = [0, 1, 2].map((i) => f(grid.north[o + i]!));
    const s = [0, 1, 2].map((i) => grid.centers[o + i]! * R);
    for (const [cu, cv, ch] of [
      [3, -4, 1.6],
      [-60, 25, 2.2],
      [90, 90, 40],
    ]) {
      grid.fromPlotLocal(site as PlotId, cu! * 1000, cv! * 1000, p);
      const cam = [p.x * (R + ch!), p.y * (R + ch!), p.z * (R + ch!)];
      const camToSite = [0, 1, 2].map((i) => f(cam[i]! - s[i]!));
      for (const [u, v, h] of [
        [cu! + 0.4, cv! - 0.7, -0.3],
        [cu! - 18.25, cv! + 30.5, 3],
        [-100, 105, 25],
        [0.013, -0.021, 0],
      ]) {
        grid.fromPlotLocal(site as PlotId, u! * 1000, v! * 1000, p);
        const frag = [p.x * (R + h!), p.y * (R + h!), p.z * (R + h!)];
        const local = [0, 1, 2].map((i) => f(frag[i]! - cam[i]!));
        const D = [0, 1, 2].map((i) => f(camToSite[i]! + local[i]!));
        const dot = (a: number[]): number => f(f(f(D[0]! * a[0]!) + f(D[1]! * a[1]!)) + f(D[2]! * a[2]!));
        const k = f(R / Math.max(f(R + dot(n)), 1));
        const gx = f(dot(e) * k);
        const gz = -f(dot(t) * k);
        const [x, z] = projectTerrainDustPoint(grid, site, frag);
        worst = Math.max(worst, Math.abs(gx - x), Math.abs(gz - z));
        expect(x).toBeCloseTo(u!, 6);
        expect(z).toBeCloseTo(-v!, 6);
      }
    }
  }
  // The lookup cell is 1 m and a tool stroke is >= 0.1 m wide: 1 mm is far below anything visible.
  expect(worst).toBeLessThan(1e-3);
}, 60_000);

it("builds the terrain layer graph and releases its feed binding", () => {
  const grid = scenarioGrid();
  const bound: unknown[] = [];
  const ground = new TerrainDustGround(
    {
      grid,
      ledger: makeScenarioLedger(),
      sitePlot: grid.plotAtXYZ(0, 1, 0),
      bind: (atlas) => {
        bound.push(atlas);
      },
      pump: () => {},
      info: () => ({}),
    },
    "low",
  );
  try {
    const result = ground.regolithLayer({
      coord: vec3(0),
      local: vec3(0),
      world: vec3(0, 2000, 0),
      toCamera: vec3(0, 1, 0),
      normal: vec3(0, 1, 0),
      toWorldGradient: (slope) => vec3(slope.x, 0, slope.y),
    });
    expect(result.fetches).toBe(8);
    expect(result.thickness).toBeDefined();
    expect(result.slope).toBeDefined();
    expect(bound[0]).toBe(ground.layer.atlas);
  } finally {
    ground.dispose();
  }
  expect(bound.at(-1)).toBeNull();
}, 60_000);
