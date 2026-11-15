// Tool-head motion, stroke emission and Dust Cell rules (WDS sections 4.4 and 4.6; game-feel sections 3.1 to 3.6).
//
// Head path: each stroke cycle of T ms has a contact phase (70 %) pushing the head from d - L to d in front of the body
// (smoothstep eased) and a lift phase returning it. The phase is derived from the input sequence number:
//   phaseMs = (((inputSeq - seqAtToolDown) mod 65536) * stepMs) mod T        (all integers)
// so the predicting client and the server produce the same head path from the same inputs.
//
// Strokes: on ticks where tick % frameIntervalTicks == 0 (one stroke per tool per frame interval), the segment from the
// contact anchor (contact point one interval ago, or where contact began) to the current contact point (or the last
// contact point if the head lifted meanwhile) becomes a StrokeRecord. Endpoints are quantised to integer mm in the
// anchor plot frame (plot containing the end point) through the PlotGrid before any other use.
//
// Dust Cell: a stroke is accepted only while the Cell is below capacity (decided before the stroke touches the
// ledger); milligrams accumulate per actor and whole grams move to the Cell, clamped to capacity (excess lost).

import type { MutableUnitDirection, PlotGrid, PlotId, PlotLocalMm, StrokeRecord, Tick } from "@moon-cleanup/shared";
import { STROKE_DEPTH16_MAX, STROKE_MAX_SEGMENT_MM } from "@moon-cleanup/shared";
import type { SimConfig, ToolTuning } from "../config/sim-config";
import { quantize } from "../math/quantize";
import type { AvatarState, SimGround } from "../movement/avatar";
import { MOVE_GROUNDED } from "../movement/avatar";

/** Mutable stroke record (pooled by the room; consumers must copy what they keep). */
export class MutableStroke implements StrokeRecord {
  anchor = 0 as PlotId;
  startUMm = 0;
  startVMm = 0;
  endUMm = 0;
  endVMm = 0;
  widthCm = 1;
  depth16 = 0;
  toolCode = 0;
  tick = 0 as Tick;
  actorSlot = 0;
  inputSeq = 0;
}

/** Per-actor tool and Dust Cell state. */
export class ToolState {
  /** Tool code of the equipped tool (index into the game-data tool table). */
  toolCode = 0;
  holsterSlot = 0;
  /** Ticks left of a holster swap (no sweeping while > 0). */
  swapTicks = 0;
  /** Bitmask of owned tool codes. */
  owned = 0;
  sweeping = false;
  detailing = false;
  wasActive = false;
  seqAtToolDown = 0;
  /** Aim distance as 0 .. 1 of reach (snapshot). */
  aim01 = 0;
  laneLocked = false;
  laneAngle = 0;
  // Head (moon-centred metres, quantised) and contact bookkeeping.
  headX = 0;
  headY = 0;
  headZ = 0;
  headValid = false;
  inContact = false;
  speedLifted = false;
  anchorValid = false;
  anchorX = 0;
  anchorY = 0;
  anchorZ = 0;
  lastContactValid = false;
  lastX = 0;
  lastY = 0;
  lastZ = 0;
  /** Ms until the next Detailing disc may be emitted. */
  detailCooldownMs = 0;
  /** Dust Cell grams per tool code (each tool has its own Cell). */
  readonly cellGrams: Int32Array;
  /** Cell level (0 = base, 1..3 = I..III) per tool code. */
  readonly cellLevel: Uint8Array;
  /** Milligram remainder carried between strokes (deterministic, no float). */
  mgAccum = 0;
  nearFullLatched = false;
  fullLatched = false;
  /** Strokes not emitted because the Cell was full (counted, not an error). */
  rejectedFull = 0;
  /** Shift-wide Dust Cell capacity bonus (Densifier, board stat `cellCapacityBonus`), added to every Cell. */
  cellCapacityBonus = 0;

  constructor(toolCount: number) {
    this.cellGrams = new Int32Array(toolCount);
    this.cellLevel = new Uint8Array(toolCount);
  }
}

/**
 * Dust Cell capacity in grams for `tool` at `level` (0 = base, 1..3 = Cell I..III): base x levelMult x (1 + bonus)
 * (progression section 5; `bonus` = Densifier +0.2 / +0.4).
 */
export function cellCapGrams(cfg: SimConfig, tool: ToolTuning, level: number, bonus = 0): number {
  if (!tool.cleans) return 0;
  const mult = level > 0 ? (cfg.cellLevelMult[level - 1] ?? 1) : 1;
  return Math.round(tool.cellBaseGrams * mult * (1 + (bonus > 0 ? bonus : 0)));
}

/** Capacity of the Cell of `code` for this actor (its level and the shift's Densifier bonus). */
export function actorCellCap(cfg: SimConfig, t: ToolState, code: number): number {
  return cellCapGrams(cfg, cfg.tools[code]!, t.cellLevel[code] ?? 0, t.cellCapacityBonus);
}

/** Re-derives the near-full / full latches of the equipped Cell after its fill changed outside a stroke. */
export function relatchCell(cfg: SimConfig, t: ToolState): void {
  const cap = actorCellCap(cfg, t, t.toolCode);
  const g = t.cellGrams[t.toolCode] ?? 0;
  t.nearFullLatched = cap > 0 && g >= cap * cfg.toolFeel.cellNearFullFrac;
  t.fullLatched = cap > 0 && g >= cap;
}

/** depth16 = min(255, floor(16 x Depth x (1 - night penalty))) (WDS section 4.4). Charge and Detailing use 255. */
export function strokeDepth16(cfg: SimConfig, tool: ToolTuning, night: boolean, lampLevel: number): number {
  if (tool.charge) return STROKE_DEPTH16_MAX;
  let penalty = night ? cfg.nightPenaltyFrac - cfg.lampPenaltyReliefFrac * lampLevel : 0;
  if (penalty < 0) penalty = 0;
  const d = Math.floor(16 * tool.depthLevels * (1 - penalty) + 1e-9);
  return d > STROKE_DEPTH16_MAX ? STROKE_DEPTH16_MAX : d;
}

/** Head offset in front of the body (metres) and whether the phase is a contact phase. */
export function headPhase(tool: ToolTuning, aimM: number, phaseMs: number, out: Float64Array): void {
  out[0] = aimM;
  out[1] = phaseMs;
  headPhaseIO(tool, out);
}

/**
 * `headPhase` with the aim read from `io[0]` and the phase (ms) from `io[1]` (hot path: no float64 argument or return
 * to box when V8 does not inline). The smoothstep is written out in place for the same reason: a `smoothstep01(t)`
 * helper boxed its argument and result on every call V8 did not inline (Pass 6, alloc guard).
 */
function headPhaseIO(tool: ToolTuning, io: Float64Array): void {
  const aimM = io[0]!;
  const phaseMs = io[1]!;
  const L = tool.pushM;
  if (phaseMs < tool.contactMs) {
    const t = phaseMs / tool.contactMs;
    const x = t < 0 ? 0 : t > 1 ? 1 : t;
    io[0] = aimM - L + L * (x * x * (3 - 2 * x));
    io[1] = 1;
  } else {
    const liftMs = tool.periodMs - tool.contactMs;
    const t = liftMs > 0 ? (phaseMs - tool.contactMs) / liftMs : 1;
    const x = t < 0 ? 0 : t > 1 ? 1 : t;
    io[0] = aimM - L * (x * x * (3 - 2 * x));
    io[1] = 0;
  }
}

// Scratch (module-level, reused). Same rule as movement/avatar.ts: hot helpers take no float64 arguments and return
// none, because a call V8 does not inline boxes each one into a fresh HeapNumber.
/** headPhaseIO: in [0] = aim distance, [1] = phase (ms); out [0] = head distance, [1] = 1 in the contact phase. */
const phaseOut = new Float64Array(2);
/** placeHead: [0] = head distance in front of the body. */
const headDist = new Float64Array(1);
/** quantiseSegment: start xyz (0..2), end xyz (3..5), moon-centred metres. */
const segment = new Float64Array(6);
const local: PlotLocalMm = { u: 0, v: 0 };

/**
 * Query direction for the plot grid. A class (own map) rather than an `{ x, y, z }` literal: literals share one map
 * tree process-wide, and once any code stores a non-number there the fields turn tagged and every double store here
 * would box a fresh HeapNumber.
 */
class DirScratch implements MutableUnitDirection {
  x = 0.5;
  y = 0.5;
  z = 0.5;
}
const dirScratch = new DirScratch();

/** Inputs of one tool tick that the room derives from the input. */
export interface ToolTickInput {
  readonly seq: number;
  /** Aim distance 0 .. 255 of reach. */
  readonly toolParam: number;
  readonly night: boolean;
  readonly lampLevel: number;
}

/**
 * Updates the head of an actor for this tick and, on stroke ticks, fills `out` with the stroke to emit.
 * Returns true when a stroke is ready (not yet checked against the Cell or the ledger).
 */
export function stepToolHead(
  a: AvatarState,
  t: ToolState,
  input: ToolTickInput,
  cfg: SimConfig,
  ground: SimGround,
  grid: PlotGrid,
  tick: number,
  actorSlot: number,
  out: MutableStroke,
): boolean {
  const tool = cfg.tools[t.toolCode]!;
  const active = (t.sweeping || t.detailing) && tool.cleans && t.swapTicks === 0;
  if (active && !t.wasActive) {
    t.seqAtToolDown = input.seq;
    t.anchorValid = false;
    t.lastContactValid = false;
    t.headValid = false;
    t.speedLifted = false;
    t.detailCooldownMs = 0;
  }
  t.wasActive = active;
  if (!active) {
    t.inContact = false;
    t.anchorValid = false;
    t.lastContactValid = false;
    t.headValid = false;
    return false;
  }
  // Aim distance from toolParam, clamped to [aimMin, reach].
  let aim = (tool.reachM * input.toolParam) / 255;
  if (aim < tool.aimMinM) aim = tool.aimMinM;
  if (aim > tool.reachM) aim = tool.reachM;
  t.aim01 = tool.reachM > 0 ? aim / tool.reachM : 0;

  const stroke = tick % cfg.frameIntervalTicks === 0;
  const footOk = a.moveState === MOVE_GROUNDED || (tool.flick && a.heightAboveGround <= cfg.toolFeel.flickMaxHeightM);

  if (t.detailing && tool.detailing) {
    // Detailing: a disc at the reticle, one per stroke period, on stroke ticks.
    headDist[0] = aim;
    placeHead(a, cfg, ground, t);
    // The stored cooldown never goes below zero, so no debt builds up while a disc cannot fire (airborne, or waiting
    // for a stroke tick); otherwise discs would fire every stroke tick after landing until the debt was repaid. The
    // only carry is the at most one step overshoot on the firing tick (with 2-tick strokes and a 450 ms period the
    // gaps alternate 400 / 500 ms, averaging the period). Flooring the read also heals a negative restored value.
    const next = (t.detailCooldownMs > 0 ? t.detailCooldownMs : 0) - cfg.stepMs;
    t.inContact = footOk;
    if (stroke && footOk && next <= 0) {
      t.detailCooldownMs = next + tool.periodMs; // >= 0: next >= -stepMs and periodMs >= stepMs
      segment[0] = segment[3] = t.headX;
      segment[1] = segment[4] = t.headY;
      segment[2] = segment[5] = t.headZ;
      if (!quantiseSegment(grid, a, out)) return false;
      out.widthCm = cfg.detailingWidthCm;
      out.depth16 = STROKE_DEPTH16_MAX;
      finishStroke(out, tool, tick, actorSlot, input.seq);
      return true;
    }
    t.detailCooldownMs = next > 0 ? next : 0;
    return false;
  }

  const seqDelta = (input.seq - t.seqAtToolDown) & 0xffff;
  const phaseMs = (seqDelta * cfg.stepMs) % tool.periodMs;
  phaseOut[0] = aim;
  phaseOut[1] = phaseMs;
  headPhaseIO(tool, phaseOut);
  const prevX = t.headX;
  const prevY = t.headY;
  const prevZ = t.headZ;
  const hadPrev = t.headValid;
  headDist[0] = phaseOut[0]!;
  placeHead(a, cfg, ground, t);
  // Head speed hysteresis (lift above 5.5 m/s, drop below 5.0 m/s).
  if (hadPrev) {
    const dx = t.headX - prevX;
    const dy = t.headY - prevY;
    const dz = t.headZ - prevZ;
    const v = Math.sqrt(dx * dx + dy * dy + dz * dz) / cfg.dt;
    if (t.speedLifted) {
      if (v < cfg.toolFeel.headDropMps) t.speedLifted = false;
    } else if (v > cfg.toolFeel.headLiftMps) {
      t.speedLifted = true;
    }
  }
  const contact = phaseOut[1] === 1 && footOk && !t.speedLifted;
  t.inContact = contact;
  if (contact) {
    if (!t.anchorValid) {
      t.anchorValid = true;
      t.anchorX = t.headX;
      t.anchorY = t.headY;
      t.anchorZ = t.headZ;
    }
    t.lastContactValid = true;
    t.lastX = t.headX;
    t.lastY = t.headY;
    t.lastZ = t.headZ;
  }
  if (!stroke) return false;
  let emitted = false;
  if (t.anchorValid && t.lastContactValid) {
    const same = t.anchorX === t.lastX && t.anchorY === t.lastY && t.anchorZ === t.lastZ;
    if (!same) {
      segment[0] = t.anchorX;
      segment[1] = t.anchorY;
      segment[2] = t.anchorZ;
      segment[3] = t.lastX;
      segment[4] = t.lastY;
      segment[5] = t.lastZ;
      if (quantiseSegment(grid, a, out)) {
        out.widthCm = tool.widthCm;
        out.depth16 = strokeDepth16(cfg, tool, input.night, input.lampLevel);
        finishStroke(out, tool, tick, actorSlot, input.seq);
        emitted = true;
      }
    }
  }
  if (contact) {
    t.anchorX = t.headX;
    t.anchorY = t.headY;
    t.anchorZ = t.headZ;
    t.anchorValid = true;
  } else {
    t.anchorValid = false;
    t.lastContactValid = false;
  }
  return emitted;
}

function finishStroke(out: MutableStroke, tool: ToolTuning, tick: number, actorSlot: number, seq: number): void {
  out.toolCode = tool.code;
  out.tick = tick as Tick;
  out.actorSlot = actorSlot;
  out.inputSeq = seq & 0xffff;
}

/** Head on the ground `headDist[0]` metres in front of the body along the facing. */
function placeHead(a: AvatarState, cfg: SimConfig, ground: SimGround, t: ToolState): void {
  const dist = headDist[0]!;
  const l = Math.sqrt(a.px * a.px + a.py * a.py + a.pz * a.pz);
  const r = l - a.heightAboveGround; // foot point radius (ground under the body)
  const k = r / l;
  const x = a.px * k + a.fx * dist;
  const y = a.py * k + a.fy * dist;
  const z = a.pz * k + a.fz * dist;
  const hl = Math.sqrt(x * x + y * y + z * z);
  const ux = x / hl;
  const uy = y / hl;
  const uz = z / hl;
  const rg = cfg.moonRadiusM + ground.heightAtXYZ(ux, uy, uz);
  t.headX = quantize(ux * rg);
  t.headY = quantize(uy * rg);
  t.headZ = quantize(uz * rg);
  t.headValid = true;
}

/**
 * Quantises the segment in `segment` (start, end) into the anchor frame (plot of the end point). False if it is
 * invalid (too long).
 */
function quantiseSegment(grid: PlotGrid, a: AvatarState, out: MutableStroke): boolean {
  const sx = segment[0]!;
  const sy = segment[1]!;
  const sz = segment[2]!;
  const ex = segment[3]!;
  const ey = segment[4]!;
  const ez = segment[5]!;
  let l = Math.sqrt(ex * ex + ey * ey + ez * ez);
  dirScratch.x = ex / l;
  dirScratch.y = ey / l;
  dirScratch.z = ez / l;
  const anchor = grid.plotAt(dirScratch, a.plotHint as PlotId);
  a.plotHint = anchor;
  grid.toPlotLocal(anchor, dirScratch, local);
  out.endUMm = local.u;
  out.endVMm = local.v;
  l = Math.sqrt(sx * sx + sy * sy + sz * sz);
  dirScratch.x = sx / l;
  dirScratch.y = sy / l;
  dirScratch.z = sz / l;
  grid.toPlotLocal(anchor, dirScratch, local);
  out.startUMm = local.u;
  out.startVMm = local.v;
  out.anchor = anchor;
  const du = out.endUMm - out.startUMm;
  const dv = out.endVMm - out.startVMm;
  return du * du + dv * dv <= STROKE_MAX_SEGMENT_MM * STROKE_MAX_SEGMENT_MM;
}
