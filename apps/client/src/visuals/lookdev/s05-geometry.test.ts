// S05 ramp canopy and its shadow probes (M1 lookdev): the canopy's shadow must land on the half of the ramp that is above
// the ground, and a probe must never be a point the camera cannot see: under the ground (the M0 `slopeShadow` defect: it
// read lit, luma 170) or on the far face of the wall.

import { describe, expect, it } from "vitest";
import {
  RAMP_CANOPY_HEIGHT_M,
  RAMP_CANOPY_X_M0,
  RAMP_CANOPY_Z_M,
  RAMP_CENTRE_X,
  RAMP_HALF_X_M,
  RAMP_HALF_Z_M,
  RAMP_SHADOW_CENTRE_M,
  RAMP_TILT_DEG,
  S05_CANOPY_EDGE_M,
  S05_DESIGN_SUN,
  rampCanopyLocalX,
  rampCanopyShadow,
  rampPoint,
  rampVisibleSide,
  s05GroundY,
  wallProbe,
  type Point3,
} from "./s05-geometry";
import { directionFromAzEl } from "../sky/sky-math";

const DEG = Math.PI / 180;
const AWAY = -RAMP_TILT_DEG * DEG;
const TOWARD = RAMP_TILT_DEG * DEG;
const sun = (sunElevationDeg: number, sunAzimuthDeg = 200) => ({ sunElevationDeg, sunAzimuthDeg });

/** Ramp-local (x, y) of a world point (the inverse of `rampPoint`). */
function toLocal(tilt: number, p: Point3): { x: number; y: number; z: number } {
  const dx = p[0] - RAMP_CENTRE_X;
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  return { x: dx * c + p[1] * s, y: -dx * s + p[1] * c, z: p[2] };
}

/** `true` when `p` lies on the sun ray through the canopy centre (so it is the centre of the canopy's shadow). */
function onCanopyRay(tilt: number, canopyX: number, s: ReturnType<typeof sun>, p: Point3): boolean {
  const top = rampPoint(tilt, canopyX, RAMP_CANOPY_HEIGHT_M, RAMP_CANOPY_Z_M);
  const d = directionFromAzEl(s.sunAzimuthDeg, s.sunElevationDeg, { x: 0, y: 0, z: 0 });
  const t = (top[1] - p[1]) / d.y;
  return Math.abs(top[0] - d.x * t - p[0]) < 1e-3 && Math.abs(top[2] - d.z * t - p[2]) < 1e-3 && t > 0;
}

describe("S05 ramp", () => {
  it("has one half of its top face above the ground and the other buried", () => {
    for (const tilt of [AWAY, TOWARD]) {
      const side = rampVisibleSide(tilt);
      const up = rampPoint(tilt, side * 3, 0, 0);
      const down = rampPoint(tilt, -side * 3, 0, 0);
      expect(up[1]).toBeGreaterThan(s05GroundY(up[0], up[2]) + 0.9);
      expect(down[1]).toBeLessThan(s05GroundY(down[0], down[2]) - 0.8);
    }
    expect(rampVisibleSide(AWAY)).toBe(-1);
    expect(rampVisibleSide(TOWARD)).toBe(1);
  });
});

describe("ramp canopy placement", () => {
  it("puts the shadow centre at the design sun on the visible half, the whole 7 m shadow clear of the hinge props", () => {
    for (const tilt of [AWAY, TOWARD]) {
      const side = rampVisibleSide(tilt);
      const canopyX = rampCanopyLocalX(tilt);
      const hit = rampCanopyShadow(tilt, canopyX, S05_DESIGN_SUN);
      expect(hit?.onRamp).toBe(true);
      if (hit === null) continue;
      expect(onCanopyRay(tilt, canopyX, S05_DESIGN_SUN, hit.point)).toBe(true);
      const local = toLocal(tilt, hit.point);
      expect(local.x).toBeCloseTo(side * RAMP_SHADOW_CENTRE_M, 6);
      expect(local.y).toBeCloseTo(0, 6);
      // Above the ground by a clear margin, and inside the slab.
      expect(hit.point[1]).toBeGreaterThan(s05GroundY(hit.point[0], hit.point[2]) + 1);
      expect(Math.abs(local.z)).toBeLessThan(RAMP_HALF_Z_M - S05_CANOPY_EDGE_M / 2);
      // The canopy is parallel to the face, so its shadow is its 7 m footprint: 0.5 m off the hinge (post, rock, boots).
      const near = Math.abs(local.x) - S05_CANOPY_EDGE_M / 2;
      expect(near).toBeCloseTo(0.5, 6);
      // A 48 px harness patch at the centre stays inside: 3 m to the nearest edge of the face or of the shadow.
      expect(RAMP_HALF_X_M - Math.abs(local.x)).toBeCloseTo(3, 6);
    }
    expect(rampCanopyLocalX(AWAY)).toBeCloseTo(-9.648, 2);
    expect(rampCanopyLocalX(TOWARD)).toBeCloseTo(3.254, 2);
  });
});

describe("ramp canopy shadow point", () => {
  it("M0 placement at sun 60 / 200: the shadow is on the flat ground; the old ramp-plane point was 0.8 m under it", () => {
    const hit = rampCanopyShadow(AWAY, RAMP_CANOPY_X_M0, sun(60));
    expect(hit?.onRamp).toBe(false);
    if (hit === null) return;
    expect(onCanopyRay(AWAY, RAMP_CANOPY_X_M0, sun(60), hit.point)).toBe(true);
    expect(hit.point[1]).toBeCloseTo(s05GroundY(hit.point[0], hit.point[2]), 4);
    expect(hit.point[0]).toBeCloseTo(-19.95, 1);
    expect(hit.point[2]).toBeCloseTo(3.15, 1);

    // What `slopeShadow` returned until M1: the hit on the infinite ramp plane, (-19.51, -0.91, 3.31).
    const top = rampPoint(AWAY, RAMP_CANOPY_X_M0, RAMP_CANOPY_HEIGHT_M, RAMP_CANOPY_Z_M);
    const d = directionFromAzEl(200, 60, { x: 0, y: 0, z: 0 });
    const n = [-Math.sin(AWAY), Math.cos(AWAY)] as const;
    const t = ((RAMP_CENTRE_X - top[0]) * n[0] - top[1] * n[1]) / (d.x * n[0] + d.y * n[1]);
    const old: Point3 = [top[0] + d.x * t, top[1] + d.y * t, top[2] + d.z * t];
    expect(old[0]).toBeCloseTo(-19.512, 2);
    expect(old[1]).toBeCloseTo(-0.906, 2);
    expect(old[1]).toBeLessThan(s05GroundY(old[0], old[2]) - 0.75);
  });

  it("never returns a point under the ground, and is on the ramp only while the shadow centre is on the visible face", () => {
    for (const tilt of [AWAY, TOWARD]) {
      for (const canopyX of [rampCanopyLocalX(tilt), RAMP_CANOPY_X_M0]) {
        for (const el of [89, 75, 60, 45, 30, 15, 4]) {
          for (const az of [200, 250, 20, 110]) {
            const hit = rampCanopyShadow(tilt, canopyX, sun(el, az));
            if (hit === null) continue;
            const ground = s05GroundY(hit.point[0], hit.point[2]);
            expect(hit.point[1]).toBeGreaterThanOrEqual(ground - 1e-6);
            expect(onCanopyRay(tilt, canopyX, sun(el, az), hit.point)).toBe(true);
            const local = toLocal(tilt, hit.point);
            if (hit.onRamp) {
              expect(Math.abs(local.y)).toBeLessThan(1e-6);
              expect(Math.abs(local.x)).toBeLessThanOrEqual(RAMP_HALF_X_M);
              expect(Math.abs(local.z)).toBeLessThanOrEqual(RAMP_HALF_Z_M);
              // The ground cap curves 0.12 m down by the ramp, so the face stays visible up to 0.4 m past the hinge.
              expect(local.x * rampVisibleSide(tilt)).toBeGreaterThan(-0.4);
            } else {
              expect(hit.point[1]).toBeCloseTo(ground, 3);
            }
          }
        }
      }
    }
  });

  it("leaves the ramp when the sun drops (30 degrees: flat ground), and does not exist without a sun or off the ground cap", () => {
    const canopyX = rampCanopyLocalX(AWAY);
    expect(rampCanopyShadow(AWAY, canopyX, sun(30))?.onRamp).toBe(false);
    expect(rampCanopyShadow(AWAY, canopyX, sun(15))?.onRamp).toBe(false);
    expect(rampCanopyShadow(AWAY, canopyX, sun(0))).toBeNull();
    expect(rampCanopyShadow(AWAY, canopyX, sun(-5))).toBeNull();
    // 8 m up at 1 degree: 458 m away, past the 170 m cap.
    expect(rampCanopyShadow(AWAY, canopyX, sun(1))).toBeNull();
  });
});

describe("wall probes", () => {
  it("at the scene's sun the shaded face looks toward +z, and each face is reported only to a camera in front of it", () => {
    // `wide` (camera z = -19) looks at the lit face; `wall` (camera z = 7.5) at the shaded one.
    expect(wallProbe("lit", sun(60), -19)).toEqual([8, 1.2, -0.17]);
    expect(wallProbe("shadow", sun(60), -19)).toBeNull();
    expect(wallProbe("shadow", sun(60), 7.5)).toEqual([8, 1.2, 0.17]);
    expect(wallProbe("lit", sun(60), 7.5)).toBeNull();
    // Inside the wall's thickness neither face is in view.
    expect(wallProbe("lit", sun(60), 0)).toBeNull();
    expect(wallProbe("shadow", sun(60), 0.1)).toBeNull();
  });

  it("follows the sun to the other side, and does not exist when the sun is down or runs along the wall", () => {
    expect(wallProbe("lit", sun(60, 90), 7.5)).toEqual([8, 1.2, 0.17]);
    expect(wallProbe("shadow", sun(60, 90), -19)).toEqual([8, 1.2, -0.17]);
    expect(wallProbe("lit", sun(-1), -19)).toBeNull();
    expect(wallProbe("lit", sun(60, 180), -19)).toBeNull();
    expect(wallProbe("shadow", sun(60, 0), 7.5)).toBeNull();
  });
});
