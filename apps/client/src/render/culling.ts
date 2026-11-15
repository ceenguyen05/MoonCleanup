// Culling and LOD selection (docs/architecture/rendering-pipeline.md section 10.1). Pure math: no three, no DOM, no
// allocation after construction. Callers own their objects and their bounding spheres; this file only answers "is it
// worth submitting" and "which LOD", so every owner (props, pucks, robots, builds) culls by the same rules.
//
//   horizon   an object is hidden when its bounding sphere lies entirely behind the horizon of the moon sphere
//             (R + global minimum height) as seen from the camera. At eye level the horizon is 82.5 m away, so this
//             removes almost the whole world.
//   distance  per object class (props 150 m, Dust Pucks 120 m, robots by the preset, builds 400 m) x the preset's
//             object multiplier.
//   frustum   the four side planes of the view-projection matrix. Near and far are left out on purpose: they differ
//             between the depth conventions (reversed-Z WebGPU, WebGL2 fallback) and the distance rule covers "far".
//   LOD       screen-size switching with 10 % hysteresis.
//
// Coordinates are moon-centred metres unless a centre is given.

import type { QualitySettings } from "@moon-cleanup/shared";

// ---- Distance -----------------------------------------------------------------------------------------------------

export const CULL_CLASSES = ["prop", "puck", "robot", "build"] as const;
export type CullClass = (typeof CULL_CLASSES)[number];

/** Section 10.1 base distances in metres, before the preset multiplier. */
export const CULL_BASE_DISTANCE_M: Readonly<Record<CullClass, number>> = {
  prop: 150,
  puck: 120,
  robot: 300,
  build: 400,
};

/**
 * Distance in metres beyond which an object of `cullClass` is not drawn on these settings: the section 10.1 base times
 * `distances.objectMult`. Robots read the preset's own `distances.robotRenderM` (the contract states it per preset).
 */
export function cullDistanceM(cullClass: CullClass, settings: Pick<QualitySettings, "distances">): number {
  if (cullClass === "robot") return settings.distances.robotRenderM;
  return CULL_BASE_DISTANCE_M[cullClass] * settings.distances.objectMult;
}

// ---- Horizon ------------------------------------------------------------------------------------------------------

/**
 * Horizon culling against one occluder sphere (the moon at its lowest ground). Set the camera once per frame, then test
 * bounding spheres. A camera at or below the occluder radius culls nothing.
 */
export class HorizonCuller {
  private cx = 0;
  private cy = 0;
  private cz = 0;
  /** Unit axis from the camera toward the occluder centre. */
  private ax = 0;
  private ay = 0;
  private az = 0;
  /** Camera distance from the centre, tangent length to the horizon, distance of the horizon plane along the axis. */
  private d = 0;
  private tangent = 0;
  private planeT = 0;
  private radius = 0;
  private active = false;

  /**
   * `occluderRadiusM` = moon radius + global minimum height (the lowest ground: never hides what a crater floor shows).
   * The camera position is relative to the occluder centre.
   */
  setCamera(x: number, y: number, z: number, occluderRadiusM: number): void {
    const d = Math.hypot(x, y, z);
    this.cx = x;
    this.cy = y;
    this.cz = z;
    this.d = d;
    this.radius = occluderRadiusM;
    this.active = d > occluderRadiusM && occluderRadiusM > 0;
    if (!this.active) return;
    this.ax = -x / d;
    this.ay = -y / d;
    this.az = -z / d;
    this.tangent = Math.sqrt(d * d - occluderRadiusM * occluderRadiusM);
    this.planeT = (this.tangent * this.tangent) / d;
  }

  /** Distance from the camera to its horizon on the occluder (0 when the camera is not above it). */
  get horizonDistanceM(): number {
    return this.active ? this.tangent : 0;
  }

  /**
   * `true` when the sphere (centre relative to the occluder centre, radius in metres) is entirely behind the horizon:
   * it lies inside the cone of rays that hit the occluder, by at least its radius, and wholly beyond the horizon plane.
   * Conservative: never hides a sphere any part of which can be seen.
   */
  isHidden(x: number, y: number, z: number, radiusM: number): boolean {
    if (!this.active) return false;
    const vx = x - this.cx;
    const vy = y - this.cy;
    const vz = z - this.cz;
    const t = vx * this.ax + vy * this.ay + vz * this.az;
    if (t - radiusM < this.planeT) return false;
    const lengthSq = vx * vx + vy * vy + vz * vz;
    const side = Math.sqrt(Math.max(0, lengthSq - t * t));
    // Signed distance from the centre to the cone surface (inside positive): L * sin(alpha - theta).
    return (this.radius * t - this.tangent * side) / this.d >= radiusM;
  }
}

// ---- Frustum ------------------------------------------------------------------------------------------------------

/**
 * The four side planes (left, right, bottom, top) of a view-projection matrix, normalised. `setFromMatrix` takes the 16
 * column-major elements three stores (`Matrix4.elements` of projection x view); the side planes are the same on every
 * depth convention.
 */
export class SideFrustum {
  private readonly planes = new Float64Array(16);

  setFromMatrix(e: ArrayLike<number>): void {
    const p = this.planes;
    // Rows of the matrix: row i = (e[i], e[4 + i], e[8 + i], e[12 + i]). Planes: row3 +- row0, row3 +- row1.
    for (let i = 0; i < 4; i++) {
      const row = i >> 1;
      const sign = (i & 1) === 0 ? 1 : -1;
      let a = (e[3] ?? 0) + sign * (e[row] ?? 0);
      let b = (e[7] ?? 0) + sign * (e[4 + row] ?? 0);
      let c = (e[11] ?? 0) + sign * (e[8 + row] ?? 0);
      let w = (e[15] ?? 0) + sign * (e[12 + row] ?? 0);
      const length = Math.hypot(a, b, c);
      if (length > 0) {
        a /= length;
        b /= length;
        c /= length;
        w /= length;
      }
      p[i * 4] = a;
      p[i * 4 + 1] = b;
      p[i * 4 + 2] = c;
      p[i * 4 + 3] = w;
    }
  }

  /** `true` when the sphere touches the inside of all four side planes. */
  intersectsSphere(x: number, y: number, z: number, radiusM: number): boolean {
    const p = this.planes;
    for (let i = 0; i < 16; i += 4) {
      if ((p[i] ?? 0) * x + (p[i + 1] ?? 0) * y + (p[i + 2] ?? 0) * z + (p[i + 3] ?? 0) < -radiusM) return false;
    }
    return true;
  }
}

// ---- Combined test over a sphere list -----------------------------------------------------------------------------

/** Why a sphere was rejected, counted per `cullSpheres` call (debug HUD). */
export interface CullCounts {
  visible: number;
  distance: number;
  horizon: number;
  frustum: number;
}

export function createCullCounts(): CullCounts {
  return { visible: 0, distance: 0, horizon: 0, frustum: 0 };
}

/**
 * Tests `count` bounding spheres (`spheres`: x, y, z, radius per entry, in the frame of `horizon` / `frustum`) against
 * distance, horizon and frustum, cheapest first. Writes 1 / 0 per sphere into `visibleOut` and the reject counts into
 * `counts`; returns the number visible. The camera position is the one given to `horizon.setCamera`-space coordinates.
 * `horizon` or `frustum` may be `null` to skip that test. Allocates nothing.
 */
export function cullSpheres(
  spheres: ArrayLike<number>,
  count: number,
  cameraX: number,
  cameraY: number,
  cameraZ: number,
  maxDistanceM: number,
  horizon: HorizonCuller | null,
  frustum: SideFrustum | null,
  visibleOut: Uint8Array,
  counts: CullCounts,
): number {
  counts.visible = 0;
  counts.distance = 0;
  counts.horizon = 0;
  counts.frustum = 0;
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const x = spheres[o] ?? 0;
    const y = spheres[o + 1] ?? 0;
    const z = spheres[o + 2] ?? 0;
    const r = spheres[o + 3] ?? 0;
    const dx = x - cameraX;
    const dy = y - cameraY;
    const dz = z - cameraZ;
    const reach = maxDistanceM + r;
    if (dx * dx + dy * dy + dz * dz > reach * reach) {
      visibleOut[i] = 0;
      counts.distance += 1;
    } else if (horizon !== null && horizon.isHidden(x, y, z, r)) {
      visibleOut[i] = 0;
      counts.horizon += 1;
    } else if (frustum !== null && !frustum.intersectsSphere(x, y, z, r)) {
      visibleOut[i] = 0;
      counts.frustum += 1;
    } else {
      visibleOut[i] = 1;
      counts.visible += 1;
    }
  }
  return counts.visible;
}

// ---- LOD ----------------------------------------------------------------------------------------------------------

/** Section 10.1: LOD switches carry 10 % hysteresis. */
export const LOD_HYSTERESIS = 0.1;

/**
 * Height on screen in output pixels of a sphere of `radiusM` at `distanceM`, for a camera with vertical field of view
 * `vfovRad` on a viewport `viewportHeightPx` high. Uses the output height, not the render scale: LOD must not pump when
 * dynamic resolution steps.
 */
export function projectedSizePx(radiusM: number, distanceM: number, vfovRad: number, viewportHeightPx: number): number {
  if (!(distanceM > radiusM)) return viewportHeightPx;
  return (radiusM / (distanceM * Math.tan(vfovRad / 2))) * viewportHeightPx;
}

/**
 * LOD index for an object `sizePx` high on screen. `thresholdsPx` is descending: LOD i is used while the size is at least
 * `thresholdsPx[i]`, the last LOD (index `thresholdsPx.length`) below all of them. `current` is the LOD in use (or -1 for a
 * first pick): a switch to a finer LOD needs the size to exceed the threshold by the hysteresis, a switch to a coarser one
 * to fall below it by the hysteresis, so an object sitting on a threshold does not flicker. `sizeMult` is the preset's
 * `distances.objectMult` (a multiplier on LOD distance is the same multiplier on apparent size).
 */
export function selectLod(
  current: number,
  sizePx: number,
  thresholdsPx: ArrayLike<number>,
  sizeMult = 1,
  hysteresis = LOD_HYSTERESIS,
): number {
  const size = sizePx * sizeMult;
  const levels = thresholdsPx.length;
  let ideal = levels;
  for (let i = 0; i < levels; i++) {
    if (size >= (thresholdsPx[i] ?? 0)) {
      ideal = i;
      break;
    }
  }
  if (current < 0 || current > levels || ideal === current) return ideal;
  if (ideal < current) {
    // Finer: every threshold crossed on the way must be exceeded by the margin; stop at the first that is not.
    let lod = current;
    while (lod > ideal && size >= (thresholdsPx[lod - 1] ?? 0) * (1 + hysteresis)) lod -= 1;
    return lod;
  }
  let lod = current;
  while (lod < ideal && size < (thresholdsPx[lod] ?? 0) * (1 - hysteresis)) lod += 1;
  return lod;
}
