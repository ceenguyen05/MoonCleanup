// Pilot Fence (scope-tiers section 1, M1-W2-T01): the soft boundary of the MVP area, a ring 900 m from Outpost Boreal
// measured along the surface. Pure part: distances, the marker-ring layout and the watch that reports when a position
// comes near or reaches the fence (the hook the DOT message and the compass bearing hang on). The authoritative
// `fence.reached` event is the sim's; this is the client-side view of the same geometry.

import { MVP_SCOPE, type UnitDirection } from "@moon-cleanup/shared";

export interface PilotFenceSpec {
  /** Unit direction of the outpost (Boreal: +Y). */
  readonly center: UnitDirection;
  /** Fence distance from the outpost along the surface, metres. */
  readonly radiusM: number;
  /** Moon radius R, metres. */
  readonly moonRadiusM: number;
}

export const BOREAL_DIRECTION: UnitDirection = { x: 0, y: 1, z: 0 };

export function borealPilotFence(moonRadiusM: number): PilotFenceSpec {
  return { center: BOREAL_DIRECTION, radiusM: MVP_SCOPE.pilotFenceRadiusM, moonRadiusM };
}

/** Distance from the outpost along the surface (arc on the R sphere) of the direction of point (x, y, z). */
export function fenceArcDistanceM(spec: PilotFenceSpec, x: number, y: number, z: number): number {
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len === 0) return 0;
  const c = spec.center;
  const cos = (x * c.x + y * c.y + z * c.z) / len;
  return spec.moonRadiusM * Math.acos(Math.min(1, Math.max(-1, cos)));
}

/**
 * Unit directions of `count` evenly spaced markers on the fence ring, 3 doubles each, into `out`.
 * Marker k sits at ring angle 2 pi k / count around the outpost direction.
 */
export function fenceRingDirections(spec: PilotFenceSpec, count: number, out: Float64Array): Float64Array {
  const c = spec.center;
  // Orthonormal basis (e1, e2) of the plane perpendicular to the outpost direction.
  const useX = Math.abs(c.x) < 0.9;
  const rx = useX ? 1 : 0;
  const ry = 0;
  const rz = useX ? 0 : 1;
  let e1x = ry * c.z - rz * c.y;
  let e1y = rz * c.x - rx * c.z;
  let e1z = rx * c.y - ry * c.x;
  const inv = 1 / Math.sqrt(e1x * e1x + e1y * e1y + e1z * e1z);
  e1x *= inv;
  e1y *= inv;
  e1z *= inv;
  const e2x = c.y * e1z - c.z * e1y;
  const e2y = c.z * e1x - c.x * e1z;
  const e2z = c.x * e1y - c.y * e1x;
  const theta = spec.radiusM / spec.moonRadiusM;
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  for (let k = 0; k < count; k++) {
    const phi = (2 * Math.PI * k) / count;
    const cp = Math.cos(phi) * st;
    const sp = Math.sin(phi) * st;
    out[k * 3] = ct * c.x + cp * e1x + sp * e2x;
    out[k * 3 + 1] = ct * c.y + cp * e1y + sp * e2y;
    out[k * 3 + 2] = ct * c.z + cp * e1z + sp * e2z;
  }
  return out;
}

export type PilotFenceZone = "inside" | "near" | "reached";

export interface PilotFenceReport {
  zone: PilotFenceZone;
  /** Distance from the outpost along the surface, metres. */
  distanceFromOutpostM: number;
  /** Metres left to the fence (negative beyond it). */
  distanceToFenceM: number;
}

export interface PilotFenceHooks {
  /** Called on every zone change. `reached` is where the DOT message is shown; `near` drives the compass bearing. */
  onZone?(report: Readonly<PilotFenceReport>): void;
}

/** Distance from the fence at which the zone becomes `near` (ui slices: compass bearing within 100 m). */
export const PILOT_FENCE_NEAR_M = 100;
/** Hysteresis on leaving a zone, metres (no flicker while standing on the line). */
const HYSTERESIS_M = 2;

/** Tracks one position against the fence. `update` allocates nothing. */
export class PilotFenceWatch {
  readonly report: PilotFenceReport = { zone: "inside", distanceFromOutpostM: 0, distanceToFenceM: 0 };

  constructor(
    readonly spec: PilotFenceSpec,
    private readonly hooks: PilotFenceHooks = {},
  ) {
    this.report.distanceToFenceM = spec.radiusM;
  }

  /** Moon-centred position (any length). Returns the current zone. */
  update(x: number, y: number, z: number): PilotFenceZone {
    const report = this.report;
    const d = fenceArcDistanceM(this.spec, x, y, z);
    const left = this.spec.radiusM - d;
    report.distanceFromOutpostM = d;
    report.distanceToFenceM = left;
    const was = report.zone;
    let zone: PilotFenceZone = was;
    if (left <= 0) zone = "reached";
    else if (was === "reached" && left < HYSTERESIS_M) zone = "reached";
    else if (left <= PILOT_FENCE_NEAR_M) zone = "near";
    else if (was !== "inside" && left < PILOT_FENCE_NEAR_M + HYSTERESIS_M) zone = "near";
    else zone = "inside";
    if (zone !== was) {
      report.zone = zone;
      this.hooks.onZone?.(report);
    }
    return zone;
  }
}
