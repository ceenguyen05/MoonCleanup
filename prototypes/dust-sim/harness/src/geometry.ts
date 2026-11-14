// Sphere helpers and the STUB grid for the dry run. The harness may use trig (it is not production sim code).
// Real runs pass the packages/world PlotGrid instead of createStubGrid(); only the ContestGrid subset is used.
import type { PlotFrame, StrokeRecord, UnitDirection } from "@moon-cleanup/shared";
import type { ContestGrid } from "./types";

export type V3 = readonly [number, number, number];

export const MOON_RADIUS_M = 2000;
const DEG = Math.PI / 180;

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const normalize = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Unit direction of lat/lon degrees: +Y north, +X lat 0 lon 0, -Z 90 E. */
export function dirFromLatLon(latDeg: number, lonDeg: number): V3 {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  return [Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)];
}

/** East and north unit tangents at a unit direction (east falls back to +X at the poles). */
export function tangentFrame(p: V3): { east: V3; north: V3 } {
  const e = cross([0, 1, 0], p);
  // Y x p points toward increasing longitude (east): at lon 0 it is -Z.
  const east = Math.hypot(e[0], e[1], e[2]) < 1e-9 ? ([1, 0, 0] as V3) : normalize(e);
  const north = normalize(cross(p, east));
  return { east, north };
}

/** Point reached from unit direction p after `arcM` metres along unit tangent t on a sphere of radius R. */
export function advanceAlong(p: V3, t: V3, arcM: number, radiusM = MOON_RADIUS_M): { dir: V3; heading: V3 } {
  const th = arcM / radiusM;
  const c = Math.cos(th);
  const s = Math.sin(th);
  return {
    dir: normalize([c * p[0] + s * t[0], c * p[1] + s * t[1], c * p[2] + s * t[2]]),
    heading: normalize([-s * p[0] + c * t[0], -s * p[1] + c * t[1], -s * p[2] + c * t[2]]),
  };
}

export function toPosition(dir: V3, heightM: number, radiusM = MOON_RADIUS_M): V3 {
  return scale(dir, radiusM + heightM);
}

// ---- Stroke conversion --------------------------------------------------------------------------------------------------

export interface StrokeParams {
  readonly toolCode: number;
  readonly widthCm: number;
  readonly depth16: number;
  readonly actorSlot: number;
}

/** Converts a tool-head motion between two surface directions into the shared StrokeRecord (plot-local mm). */
export function strokeBetween(grid: ContestGrid, from: V3, to: V3, tick: number, p: StrokeParams): StrokeRecord {
  const a = { x: to[0], y: to[1], z: to[2] } as UnitDirection;
  const b = { x: from[0], y: from[1], z: from[2] } as UnitDirection;
  const anchor = grid.plotAt(a);
  const out = { u: 0, v: 0 };
  grid.toPlotLocal(anchor, b, out);
  const startUMm = out.u;
  const startVMm = out.v;
  grid.toPlotLocal(anchor, a, out);
  return {
    anchor,
    startUMm,
    startVMm,
    endUMm: out.u,
    endVMm: out.v,
    widthCm: p.widthCm,
    depth16: p.depth16,
    toolCode: p.toolCode,
    tick: tick as StrokeRecord["tick"],
    actorSlot: p.actorSlot,
    inputSeq: tick & 0xffff,
  };
}

// ---- Stub grid (dry run only) -------------------------------------------------------------------------------------------

const STUB_ROWS = 360;

/**
 * STUB grid: latitude bands of 0.5 degrees (about 17.5 m), columns per band proportional to cos(lat). Not the GP(128,0)
 * grid and only meaningful within about 60 degrees of the equator (near the poles cells grow). It exists so the dry run
 * has real plot ids and plot-local millimetres without depending on packages/world.
 */
export function createStubGrid(): ContestGrid {
  const cols: number[] = [];
  const offset: number[] = [];
  let total = 0;
  for (let r = 0; r < STUB_ROWS; r++) {
    const lat = (-90 + (r + 0.5) * (180 / STUB_ROWS)) * DEG;
    const c = Math.max(1, Math.round(2 * STUB_ROWS * Math.cos(lat)));
    cols.push(c);
    offset.push(total);
    total += c;
  }
  const locate = (id: number): { row: number; col: number } => {
    let lo = 0;
    let hi = STUB_ROWS - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((offset[mid] ?? 0) <= id) lo = mid;
      else hi = mid - 1;
    }
    return { row: lo, col: id - (offset[lo] ?? 0) };
  };
  const centre = (id: number): V3 => {
    const { row, col } = locate(id);
    const lat = -90 + (row + 0.5) * (180 / STUB_ROWS);
    const lon = -180 + (col + 0.5) * (360 / (cols[row] ?? 1));
    return dirFromLatLon(lat, lon);
  };
  const R = MOON_RADIUS_M;
  const frameOf = (id: number): PlotFrame => {
    const n = centre(id);
    const { east, north } = tangentFrame(n);
    const u = (v: V3): UnitDirection => ({ x: v[0], y: v[1], z: v[2] }) as UnitDirection;
    return { normal: u(n), east: u(east), north: u(north) } as PlotFrame;
  };
  return {
    params: {
      gridM: 0,
      radiusM: R,
      plotCount: total,
      hexagonCount: total,
      pentagonCount: 0,
      chunkCount: 0,
      poleChunkId: 0,
      northPolePlotId: 0,
      southPolePlotId: 0,
    } as ContestGrid["params"],
    plotAt(d) {
      const lat = Math.asin(Math.max(-1, Math.min(1, d.y))) / DEG;
      const lon = Math.atan2(-d.z, d.x) / DEG;
      const row = Math.min(STUB_ROWS - 1, Math.max(0, Math.floor((lat + 90) / (180 / STUB_ROWS))));
      const n = cols[row] ?? 1;
      const col = Math.min(n - 1, Math.max(0, Math.floor((lon + 180) / (360 / n))));
      return ((offset[row] ?? 0) + col) as ReturnType<ContestGrid["plotAt"]>;
    },
    centerDirection(id) {
      const c = centre(id);
      return { x: c[0], y: c[1], z: c[2] } as UnitDirection;
    },
    frame: (id) => frameOf(id),
    toPlotLocal(id, d, out) {
      const c = centre(id);
      const { east, north } = tangentFrame(c);
      const rel: V3 = [d.x - c[0], d.y - c[1], d.z - c[2]];
      return Object.assign(out, {
        u: Math.round(dot(rel, east) * R * 1000),
        v: Math.round(dot(rel, north) * R * 1000),
      });
    },
  };
}
