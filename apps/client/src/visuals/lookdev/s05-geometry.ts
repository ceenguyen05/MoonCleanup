// Geometry of the S05 shadow lab that its probes need (pure maths, no three objects): the ramp, its shade canopy and where
// the canopy's shadow lands, and which face of the wall a camera can see.
//
// The ramp is a 14 x 22 m slab whose top face passes through the hinge line x = RAMP_CENTRE_X, y = 0 and is tilted about
// world z. Only ONE half of the top face is above the ground; the other half is buried:
//   tilt -20 degrees (`slope=away`, default): ramp-local x < 0 rises toward world -x (toward the sun at azimuth 200)
//   tilt +20 degrees (`slope=toward`):        ramp-local x > 0 rises toward world +x
// Until M1 the canopy hung over ramp-local x = -3, so at the scene's own sun (60 / 200) its shadow centre fell on the BURIED
// half: the rendered shadow lay on the flat ground beside the ramp, and the `slopeShadow` probe (the hit on the ramp PLANE)
// was 0.9 m under the ground, which projects below the shadow in a grazing view and read lit (luma 170 on Low and Medium).
// The canopy is now placed per tilt so that the shadow centre at the design sun sits RAMP_SHADOW_CENTRE_M up the visible
// half, and the probes only ever return points on a surface the camera can see.

import { MOON_RADIUS_M, sphereDrop } from "./cap-geometry";
import { directionFromAzEl } from "../sky/sky-math";

export const RAMP_CENTRE_X = -22;
export const RAMP_TILT_DEG = 20;
/** Half extents of the ramp's top face in ramp-local x and z (the slab is 14 x 22 m). */
export const RAMP_HALF_X_M = 7;
export const RAMP_HALF_Z_M = 11;
/** Edge of both shade canopies (7 x 7 m). The ramp canopy is parallel to the ramp face, this far above it, centred at this ramp-local z. */
export const S05_CANOPY_EDGE_M = 7;
export const RAMP_CANOPY_HEIGHT_M = 5;
export const RAMP_CANOPY_Z_M = 2;
/** The canopy's ramp-local x in the M0 captures (`&rampcanopy=m0`, A/B): its shadow falls beside the ramp. */
export const RAMP_CANOPY_X_M0 = -3;
/** The sun the canopy is placed for: the scene's default (`?sun=60&az=200`, VT-M0-16 noon). */
export const S05_DESIGN_SUN = { sunElevationDeg: 60, sunAzimuthDeg: 200 } as const;
/**
 * Distance of the shadow centre from the hinge, up the visible half, at the design sun: the 7 m shadow then spans 0.5 to
 * 7.5 m, clear of the post, rock and custodian that stand on the hinge and 0.5 m over the raised end.
 */
export const RAMP_SHADOW_CENTRE_M = 4;
/** Radius of the S05 ground cap; a shadow point beyond it is on nothing. */
export const S05_GROUND_RADIUS_M = 170;
/** A ramp point must be this far above the ground to count as visible (the cap is tessellated, not exact). */
const ABOVE_GROUND_M = 0.03;
/** Below this sine of the elevation over a surface the sun ray is treated as parallel to it. */
const MIN_SIN = 1e-3;

export type SunAngles = Readonly<{ sunElevationDeg: number; sunAzimuthDeg: number }>;
export type Point3 = readonly [number, number, number];

/** Where the ramp canopy's shadow centre lands. */
export interface RampShadowHit {
  readonly point: Point3;
  /** `true`: on the ramp's visible top face; `false`: on the flat ground. */
  readonly onRamp: boolean;
}

/** +1 or -1: the sign of ramp-local x on the half of the top face that is above the ground. */
export function rampVisibleSide(tiltRad: number): 1 | -1 {
  return tiltRad < 0 ? -1 : 1;
}

/** World position of ramp-local (x, y, z); y is along the ramp normal. */
export function rampPoint(tiltRad: number, x: number, y: number, z: number): Point3 {
  const c = Math.cos(tiltRad);
  const s = Math.sin(tiltRad);
  return [RAMP_CENTRE_X + x * c - y * s, x * s + y * c, z];
}

/** Height of the S05 ground (a cap of the 2 km moon, tangent at the origin) at world (x, z). */
export function s05GroundY(x: number, z: number): number {
  return sphereDrop(Math.hypot(x, z), MOON_RADIUS_M);
}

const _d = { x: 0, y: 0, z: 0 };

/**
 * Ramp-local x of the canopy centre for which the shadow centre at the design sun lies RAMP_SHADOW_CENTRE_M up the visible
 * half of the ramp (away: -9.65 m, toward: +3.25 m).
 */
export function rampCanopyLocalX(tiltRad: number): number {
  const d = directionFromAzEl(S05_DESIGN_SUN.sunAzimuthDeg, S05_DESIGN_SUN.sunElevationDeg, _d);
  const c = Math.cos(tiltRad);
  const s = Math.sin(tiltRad);
  // The unit vector toward the sun in ramp-local axes (the inverse of the ramp's rotation about z).
  const lx = d.x * c + d.y * s;
  const ly = -d.x * s + d.y * c;
  // A point `h` above the face casts its shadow at local x - h * lx / ly.
  return rampVisibleSide(tiltRad) * RAMP_SHADOW_CENTRE_M + (RAMP_CANOPY_HEIGHT_M * lx) / ly;
}

/**
 * The first visible surface the sun ray through the centre of the ramp canopy meets: the ramp's top face where that is
 * above the ground, the flat ground otherwise. `null` when the sun is at or below the horizon, or the point is off the
 * ground cap. The slab's side faces are not considered (at azimuth 200 the ray cannot reach them).
 */
export function rampCanopyShadow(tiltRad: number, canopyLocalX: number, sun: SunAngles): RampShadowHit | null {
  const d = directionFromAzEl(sun.sunAzimuthDeg, sun.sunElevationDeg, _d);
  const dx = d.x;
  const dy = d.y;
  const dz = d.z;
  if (dy <= MIN_SIN) return null;
  const c = Math.cos(tiltRad);
  const s = Math.sin(tiltRad);
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  if (ly > MIN_SIN) {
    const t = RAMP_CANOPY_HEIGHT_M / ly;
    const faceX = canopyLocalX - lx * t;
    const faceZ = RAMP_CANOPY_Z_M - dz * t;
    if (Math.abs(faceX) <= RAMP_HALF_X_M && Math.abs(faceZ) <= RAMP_HALF_Z_M) {
      const point = rampPoint(tiltRad, faceX, 0, faceZ);
      if (point[1] > s05GroundY(point[0], point[2]) + ABOVE_GROUND_M) return { point, onRamp: true };
    }
  }
  // The flat ground is a cap of the moon sphere (centre (0, -R, 0)): the first point of the ray `top - d * t` on it. A ray
  // lower than the horizon dip seen from the canopy (5 degrees from 8 m up on the 2 km moon) passes over the ground.
  const top = rampPoint(tiltRad, canopyLocalX, RAMP_CANOPY_HEIGHT_M, RAMP_CANOPY_Z_M);
  const oy = top[1] + MOON_RADIUS_M;
  const b = top[0] * dx + oy * dy + top[2] * dz;
  const disc = b * b - (top[0] * top[0] + oy * oy + top[2] * top[2] - MOON_RADIUS_M * MOON_RADIUS_M);
  if (disc < 0) return null;
  const t = b - Math.sqrt(disc);
  if (t <= 0) return null;
  const x = top[0] - dx * t;
  const z = top[2] - dz * t;
  if (Math.hypot(x, z) > S05_GROUND_RADIUS_M) return null;
  return { point: [x, top[1] - dy * t, z], onRamp: false };
}

/** The wall: 6 x 2.4 x 0.3 m, centred at (8, 1.2, 0), its two large faces at z = +-0.15. */
export const WALL_CENTRE: Point3 = [8, 1.2, 0];
export const WALL_HALF_THICKNESS_M = 0.15;
/** Distance of a wall probe from the wall's centre plane: 2 cm off the face. */
const WALL_PROBE_Z_M = 0.17;
/** Below this |z| of the unit sun direction the sun runs along the wall and neither face is "the lit one". */
const WALL_MIN_SUN_Z = 0.02;

/**
 * Mid-height point on the wall face turned toward the sun (`lit`) or away from it (`shadow`). `null` when the camera is
 * not on that side of the wall (the wall itself would hide the point, and the patch would read the OTHER face: in the
 * `wide` view `wallShadow` read the lit face, luma 170, until M1), when the sun is down, or when it runs along the wall.
 */
export function wallProbe(face: "lit" | "shadow", sun: SunAngles, cameraZ: number): Point3 | null {
  const d = directionFromAzEl(sun.sunAzimuthDeg, sun.sunElevationDeg, _d);
  if (d.y <= MIN_SIN || Math.abs(d.z) < WALL_MIN_SUN_Z) return null;
  const litSide = d.z > 0 ? 1 : -1;
  const side = face === "lit" ? litSide : -litSide;
  if ((cameraZ - WALL_CENTRE[2]) * side <= WALL_HALF_THICKNESS_M) return null;
  return [WALL_CENTRE[0], WALL_CENTRE[1], WALL_CENTRE[2] + side * WALL_PROBE_Z_M];
}
