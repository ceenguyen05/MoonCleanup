import type { StrokeRecord } from "@moon-cleanup/shared";
import { createRng } from "../../rng";
import type { ContestGrid } from "./target";

interface Dir {
  x: number;
  y: number;
  z: number;
}

export interface StrokeSourceOptions {
  readonly seed: number;
  readonly botIndex: number;
  /** Plot whose centre anchors the cluster. */
  readonly clusterPlot: number;
  /** Cluster radius in metres. */
  readonly radiusM: number;
  /** Walking speed m/s. */
  readonly speedMps: number;
  /** Strokes per second per bot. */
  readonly strokeHz: number;
  readonly widthCm: number;
  readonly depth16: number;
  readonly toolCode: number;
  readonly actorSlot: number;
}

export const DEFAULT_STROKE_SOURCE: Omit<StrokeSourceOptions, "seed" | "botIndex" | "clusterPlot" | "actorSlot"> = {
  radiusM: 40,
  speedMps: 3,
  strokeHz: 20,
  widthCm: 60,
  depth16: 16,
  toolCode: 1,
};

const norm = (d: Dir): Dir => {
  const l = Math.hypot(d.x, d.y, d.z) || 1;
  return { x: d.x / l, y: d.y / l, z: d.z / l };
};

/**
 * Deterministic boustrophedon cleaner: lanes 0.5 m apart across a square of side 2 * radius around the cluster centre,
 * each bot with its own lane phase and a seeded jitter so strokes overlap (the case that stresses ledger ordering).
 * Positions are planar offsets in the cluster plot frame, projected onto the sphere and the grid exactly.
 */
export function createStrokeSource(grid: ContestGrid, o: StrokeSourceOptions): (tick: number) => StrokeRecord {
  const rng = createRng(o.seed ^ Math.imul(o.botIndex + 1, 0x9e3779b1));
  const R = grid.params.radiusM;
  const clusterPlot = o.clusterPlot as StrokeRecord["anchor"];
  const c = grid.centerDirection(clusterPlot);
  const f = grid.frame(clusterPlot);
  const lane = 0.5;
  const span = 2 * o.radiusM;
  const lanes = Math.floor(span / lane);
  const step = o.speedMps / o.strokeHz;
  let s = rng() * span;
  let laneIx = Math.floor(rng() * lanes);
  let dirSign = 1;
  const at = (e: number, n: number): Dir =>
    norm({
      x: c.x + (e * f.east.x + n * f.north.x) / R,
      y: c.y + (e * f.east.y + n * f.north.y) / R,
      z: c.z + (e * f.east.z + n * f.north.z) / R,
    });
  const pos = (): { e: number; n: number } => {
    const along = dirSign > 0 ? s : span - s;
    return { e: along - o.radiusM, n: laneIx * lane - o.radiusM + (rng() - 0.5) * 0.04 };
  };
  const p0 = pos();
  let prev: Dir = at(p0.e, p0.n);
  const out = { u: 0, v: 0 };
  return (tick: number): StrokeRecord => {
    s += step;
    if (s >= span) {
      s = 0;
      dirSign = -dirSign;
      laneIx = (laneIx + 1) % lanes;
    }
    const p = pos();
    const end = at(p.e, p.n);
    const anchor = grid.plotAt(end);
    grid.toPlotLocal(anchor, prev, out);
    const startUMm = out.u;
    const startVMm = out.v;
    grid.toPlotLocal(anchor, end, out);
    prev = end;
    return {
      anchor,
      startUMm,
      startVMm,
      endUMm: out.u,
      endVMm: out.v,
      widthCm: o.widthCm,
      depth16: o.depth16,
      toolCode: o.toolCode,
      tick: tick as StrokeRecord["tick"],
      actorSlot: o.actorSlot,
      inputSeq: tick & 0xffff,
    };
  };
}
