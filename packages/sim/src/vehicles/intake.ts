// Vehicle cleaning: the brush drum / intake emits one stroke per frame interval while it is down, the dust goes to the
// hopper (payload cap), and the hopper unloads at a Dump Plate (WDS section 4.4 strokes, progression section 21).
//
// A vehicle stroke is an ordinary StrokeRecord: width = cleaning width (Wide Mouth included), depth16 from the vehicle's
// Depth levels (night penalty, Running Lamps relief), actor slot 16 + vehicle index (credited to the shift), input
// sequence 0 and tool code `strokeToolCodeBase + kind` (past the hand-tool codes). Like a Dust Cell, a full hopper accepts
// no strokes (decided before the ledger), so no dust is removed that cannot be carried; the intake also lifts when full.

import type { MutableUnitDirection, PlotGrid, PlotId, PlotLocalMm, Tick } from "@moon-cleanup/shared";
import {
  STROKE_DEPTH16_MAX,
  STROKE_MAX_SEGMENT_MM,
  STROKE_NON_PLAYER_ACTOR_SLOT_MIN,
  STROKE_TOOL_CODE_MAX,
  STROKE_WIDTH_CM_MAX,
} from "@moon-cleanup/shared";
import type { SimConfig } from "../config/sim-config";
import { quantize } from "../math/quantize";
import type { SimGround } from "../movement/avatar";
import { StrokeApplyResult, type DustLedgerPort } from "../dust/ledger-port";
import { MutableStroke } from "../tools/tool";
import { VEHICLE_GROUNDED, vehicleBasis, type VehicleState } from "./vehicle";
import type { VehicleTuning } from "./tuning";

/** Output of one intake tick (reused by the host). */
export class VehicleIntakeOut {
  readonly stroke = new MutableStroke();
  readonly result = new StrokeApplyResult();
  /** A stroke was applied to the ledger this tick (`stroke` and `result` are valid). */
  applied = false;
  /** Grams that reached the hopper this tick (<= result.milligrams / 1000 + carry). */
  addedGrams = 0;
  /** Strokes not emitted because the hopper was full (counted, not an error). */
  rejectedFull = 0;
}

class DirScratch implements MutableUnitDirection {
  x = 0.5;
  y = 0.5;
  z = 0.5;
}
const dir = new DirScratch();
const local: PlotLocalMm = { u: 0, v: 0 };
const basis = new Float64Array(9);
const drum = new Float64Array(3);

/** Dust the hopper can still take, grams. */
export function hopperSpaceGrams(v: VehicleState): number {
  const space = v.stats.payloadGrams - v.hopperGrams;
  return space > 0 ? space : 0;
}

/** Hopper fill over capacity, 0 .. 1. */
export function hopperFill01(v: VehicleState): number {
  const cap = v.stats.payloadGrams;
  return cap > 0 ? v.hopperGrams / cap : 0;
}

/** Hopper level for the 4-bit vehicle flag field (0 .. 15). */
export function hopperLevel4(v: VehicleState): number {
  return Math.min(15, Math.floor(hopperFill01(v) * 16));
}

/**
 * Adds `milligrams` of dust to the hopper (whole grams move, the milligram remainder carries). Returns the grams added;
 * what does not fit is lost, like a Dust Cell.
 */
export function absorbDust(v: VehicleState, milligrams: number): number {
  v.hopperMg += milligrams;
  const grams = Math.floor(v.hopperMg / 1000);
  v.hopperMg -= grams * 1000;
  const space = hopperSpaceGrams(v);
  const added = grams < space ? grams : space;
  v.hopperGrams += added;
  return added;
}

/** What a Dump Plate (or any unload target) offers: takes up to `grams` and returns what it accepted. */
export interface HopperSink {
  accept(grams: number): number;
}

/** Unloads the hopper into `sink`; whatever the sink refuses stays aboard. Returns grams delivered. */
export function dumpHopper(v: VehicleState, sink: HopperSink): number {
  if (v.hopperGrams <= 0) return 0;
  let took = sink.accept(v.hopperGrams);
  if (took < 0) took = 0;
  if (took > v.hopperGrams) took = v.hopperGrams;
  v.hopperGrams -= took;
  return took;
}

/** True when the chassis is within `radiusM` of the moon-centred point (a Dump Plate, a Motor Pool). */
export function vehicleNear(v: VehicleState, x: number, y: number, z: number, radiusM: number): boolean {
  const dx = v.px - x;
  const dy = v.py - y;
  const dz = v.pz - z;
  return dx * dx + dy * dy + dz * dz <= radiusM * radiusM;
}

/** depth16 of a vehicle stroke: min(255, floor(16 x Depth x (1 - night penalty))), Running Lamps relief included. */
export function vehicleDepth16(cfg: SimConfig, depthLevels: number, night: boolean, relief: number): number {
  let penalty = night ? cfg.nightPenaltyFrac - relief : 0;
  if (penalty < 0) penalty = 0;
  const d = Math.floor(16 * depthLevels * (1 - penalty) + 1e-9);
  return d > STROKE_DEPTH16_MAX ? STROKE_DEPTH16_MAX : d;
}

/**
 * One intake tick. On stroke ticks (`tick % frameIntervalTicks === 0`) while the intake is down, the segment from the drum
 * contact one interval ago to the drum contact now becomes a stroke; it is checked against the hopper and the Empty plots
 * (like `acceptStroke` of the room), applied to `ledger`, and its dust goes to the hopper. Allocation-free.
 * `vehicleIndex` selects the credited actor slot. Returns `out.applied`.
 */
export function stepVehicleIntake(
  v: VehicleState,
  tuning: VehicleTuning,
  cfg: SimConfig,
  grid: PlotGrid,
  ground: SimGround,
  ledger: DustLedgerPort,
  tick: number,
  vehicleIndex: number,
  night: boolean,
  out: VehicleIntakeOut,
): boolean {
  out.applied = false;
  out.addedGrams = 0;
  if (tick % cfg.frameIntervalTicks !== 0) return false;
  if (v.moveState !== VEHICLE_GROUNDED || v.speed <= 0.05 || v.boosting || v.stats.widthM <= 0) {
    v.anchorValid = false;
    return false;
  }
  if (v.hopperGrams >= v.stats.payloadGrams) {
    v.anchorValid = false;
    out.rejectedFull++;
    return false;
  }
  const kind = tuning.kinds[v.kindCode]!;
  // Drum contact point on the ground, drumForwardM ahead of the chassis.
  vehicleBasis(v, basis);
  const dist = kind.handling!.def.drumForwardM;
  const gx = v.px + basis[3]! * dist;
  const gy = v.py + basis[4]! * dist;
  const gz = v.pz + basis[5]! * dist;
  const gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
  const ux = gx / gl;
  const uy = gy / gl;
  const uz = gz / gl;
  const rg = cfg.moonRadiusM + ground.heightAtXYZ(ux, uy, uz);
  drum[0] = quantize(ux * rg);
  drum[1] = quantize(uy * rg);
  drum[2] = quantize(uz * rg);
  const hadAnchor = v.anchorValid;
  const sx = v.anchorX;
  const sy = v.anchorY;
  const sz = v.anchorZ;
  v.anchorX = drum[0];
  v.anchorY = drum[1];
  v.anchorZ = drum[2];
  v.anchorValid = true;
  if (!hadAnchor) return false;
  if (sx === drum[0] && sy === drum[1] && sz === drum[2]) return false;

  const st = out.stroke;
  // End point first: its plot is the anchor frame.
  let l = Math.sqrt(drum[0] * drum[0] + drum[1] * drum[1] + drum[2] * drum[2]);
  dir.x = drum[0] / l;
  dir.y = drum[1] / l;
  dir.z = drum[2] / l;
  const anchor = grid.plotAt(dir, v.plotHint as PlotId);
  v.plotHint = anchor;
  grid.toPlotLocal(anchor, dir, local);
  st.endUMm = local.u;
  st.endVMm = local.v;
  l = Math.sqrt(sx * sx + sy * sy + sz * sz);
  dir.x = sx / l;
  dir.y = sy / l;
  dir.z = sz / l;
  grid.toPlotLocal(anchor, dir, local);
  st.startUMm = local.u;
  st.startVMm = local.v;
  st.anchor = anchor;
  const du = st.endUMm - st.startUMm;
  const dv = st.endVMm - st.startVMm;
  if (du * du + dv * dv > STROKE_MAX_SEGMENT_MM * STROKE_MAX_SEGMENT_MM) return false;
  if (ledger.isEmptyPlot(anchor)) return false;
  const widthCm = Math.round(v.stats.widthM * 100);
  st.widthCm = widthCm < 1 ? 1 : widthCm > STROKE_WIDTH_CM_MAX ? STROKE_WIDTH_CM_MAX : widthCm;
  st.depth16 = vehicleDepth16(cfg, kind.depthLevels, night, v.stats.nightPenaltyRelief);
  const code = tuning.strokeToolCodeBase + kind.code;
  st.toolCode = code > STROKE_TOOL_CODE_MAX ? STROKE_TOOL_CODE_MAX : code;
  st.tick = tick as Tick;
  st.actorSlot = Math.min(STROKE_NON_PLAYER_ACTOR_SLOT_MIN + vehicleIndex, 63);
  st.inputSeq = 0;
  const res = out.result;
  res.clear();
  ledger.applyStroke(st, res);
  out.addedGrams = absorbDust(v, res.milligrams);
  out.applied = true;
  return true;
}
