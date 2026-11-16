// Main-thread Solo prediction of the own avatar (M1-W3-T05, E13 "input-to-first-visual <= 1 frame", solo-first rule).
//
// The Solo worker runs the authoritative RoomSim; its FRAMEs arrive 1-2 ticks after an input. To make walking answer
// at once, the render thread steps the own avatar with the SAME pure `stepAvatar` the worker runs (packages/sim), on
// the SAME inputs at send time, over the SAME ground as the worker's world (the app passes it; Solo is flat today).
// Each FRAME's Self (after input `ackInputSeq`) reconciles exactly like the online predictor (net/predictor.ts rules):
// restore the prediction recorded after the acked input, overwrite what Self carries, replay the unacknowledged
// inputs (<= 16), and keep the visual jump as a render offset that halves every 80 ms (no snap on screen).
// The MoveIntent mirrors MoonRoomSim.stepActor's movement half. Written for Solo: no protocol session, no net import,
// no allocation after construction (ring of preallocated states).
//
// Render pose (E13): between sends, the newest predicted tick is blended toward a SPECULATIVE step of the live input
// (`live`, refreshed every frame by the module) by the time since that step (0..1 tick), plus the correction offset.
// A key press therefore moves the avatar in the very next rendered frame, and the blend reaches exactly the next
// predicted state when that input is sent (the same step on the same input), so motion stays continuous.
// No extra inputs are sent: the worker still gets one per tick.

import { INPUT_AXIS_MAX, INPUT_BUTTON_MASK, type SimInputCommand } from "@moon-cleanup/shared";
import {
  AvatarState,
  MoveIntent,
  groundSlopeTan,
  headingBasis,
  stepAvatar,
  type SimConfig,
  type SimGround,
} from "@moon-cleanup/sim";
import type { AvatarPoseSource } from "./pose-source";
import { createInputCommand, type MutableInputCommand } from "../input/input-state";

/** Most inputs replayed per reconcile (same budget as the online predictor). */
export const SOLO_PREDICTION_MAX_REPLAY = 16;
/** History ring: 64 ticks. */
export const SOLO_PREDICTION_HISTORY = 64;
/** Render offset half-life after a correction (ms), same as online. */
export const SOLO_CORRECTION_HALF_LIFE_MS = 80;

/** What reconcile reads from a FRAME's Self block (protocol `SelfState` satisfies it). */
export interface SelfLike {
  readonly px: number;
  readonly py: number;
  readonly pz: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly moveState: number;
  readonly hopCharges: number;
}

const FIELDS = [
  "px",
  "py",
  "pz",
  "vx",
  "vy",
  "vz",
  "fx",
  "fy",
  "fz",
  "yawFrame",
  "moveState",
  "heightAboveGround",
  "coyoteTicks",
  "jumpBufferTicks",
  "snapOffTicks",
  "hopCharges",
  "hopMaxCharges",
  "hopRechargeTicks",
  "hopIntervalTicks",
  "recoverTicks",
  "recoverAccelMult",
  "moveLockTicks",
  "jumpLockTicks",
  "airSpeedCap",
  "plotHint",
] as const;
const FLAGS = ["active", "jumpCutUsed", "jumped", "touchdown"] as const;

function copyAvatar(src: AvatarState, dst: AvatarState): void {
  for (const k of FIELDS) dst[k] = src[k];
  for (const k of FLAGS) dst[k] = src[k];
  dst.lastLanding = src.lastLanding;
  dst.lastImpactMps = src.lastImpactMps;
}

export interface SoloPredictorStats {
  predicted: number;
  reconciles: number;
  replayed: number;
  replayCapped: number;
  unknownAcks: number;
  /** Last correction (m) between the prediction for the acked input and the worker. */
  lastCorrectionM: number;
  maxCorrectionM: number;
}

export class SoloPredictor implements AvatarPoseSource {
  readonly state = new AvatarState();
  readonly offset = new Float64Array(3);
  /** Live input of this frame (the module writes it with `InputState.peek` before `sample`). */
  readonly live: MutableInputCommand = createInputCommand();
  /** Turn off the speculative blend (tests, A/B): the pose then holds at the newest predicted tick. */
  speculate = true;
  private readonly spec = new AvatarState();
  readonly stats: SoloPredictorStats = {
    predicted: 0,
    reconciles: 0,
    replayed: 0,
    replayCapped: 0,
    unknownAcks: 0,
    lastCorrectionM: 0,
    maxCorrectionM: 0,
  };
  private readonly intent = new MoveIntent();
  /** groundSlopeTan output (Steep rule); reused, no per-step allocation. */
  private readonly slopeOut = new Float64Array(1);
  private readonly basis = new Float64Array(9);
  private readonly hist: AvatarState[] = [];
  private readonly histSeq = new Int32Array(SOLO_PREDICTION_HISTORY).fill(-1);
  private readonly inMoveX = new Int16Array(SOLO_PREDICTION_HISTORY);
  private readonly inMoveY = new Int16Array(SOLO_PREDICTION_HISTORY);
  private readonly inYaw = new Uint16Array(SOLO_PREDICTION_HISTORY);
  private readonly inButtons = new Uint16Array(SOLO_PREDICTION_HISTORY);
  private readonly prevButtonsAfter = new Uint16Array(SOLO_PREDICTION_HISTORY);
  private prevButtons = 0;
  private lastSeq = -1;
  private toolCode = 0;
  private seated = false;
  private started = false;
  private stepMs = 0;
  private lastDecayMs = 0;
  private readonly tickMs: number;

  constructor(
    private readonly cfg: SimConfig,
    private readonly ground: SimGround,
    private readonly now: () => number,
  ) {
    this.tickMs = 1000 / cfg.tickHz;
    for (let i = 0; i < SOLO_PREDICTION_HISTORY; i++) this.hist.push(new AvatarState());
  }

  get ready(): boolean {
    return this.started;
  }

  get airborne(): boolean {
    return this.started && this.state.moveState !== 0;
  }

  /** Seated in a vehicle: the avatar rides the handle (the sim moves it), so the prediction stops walking it. */
  setSeated(on: boolean): void {
    this.seated = on;
  }

  /** Equipped tool code (own `PlayerInfo.equippedTool` from shift state): speed multipliers and face-aim follow it. */
  setTool(toolCode: number): void {
    this.toolCode = toolCode;
  }

  /** Forget everything (host changed or rebooted); the next Self restarts prediction. */
  reset(): void {
    this.started = false;
    this.histSeq.fill(-1);
    this.offset.fill(0);
  }

  /** One local tick with the input just sent to the host (pump listener). Allocation-free. */
  predict(input: SimInputCommand): void {
    if (!this.started) return;
    const k = input.seq % SOLO_PREDICTION_HISTORY;
    this.inMoveX[k] = input.moveX;
    this.inMoveY[k] = input.moveY;
    this.inYaw[k] = input.yaw;
    this.inButtons[k] = input.buttons;
    this.stepSlot(k);
    this.prevButtonsAfter[k] = this.prevButtons;
    copyAvatar(this.state, this.hist[k]!);
    this.histSeq[k] = input.seq & 0xffff;
    this.lastSeq = input.seq & 0xffff;
    this.stepMs = this.now();
    this.stats.predicted++;
  }

  /** Authoritative Self after input `ackSeq` (FrameAvatarSource listener). Starts prediction on the first one. */
  reconcile(self: SelfLike, ackSeq: number): void {
    const a = this.state;
    if (!this.started) {
      a.active = true;
      applySelf(self, a);
      headingBasis(a, this.basis);
      a.fx = this.basis[3]!;
      a.fy = this.basis[4]!;
      a.fz = this.basis[5]!;
      this.histSeq.fill(-1);
      this.lastSeq = ackSeq & 0xffff;
      this.offset.fill(0);
      this.stepMs = this.now();
      this.started = true;
      return;
    }
    const ox = a.px;
    const oy = a.py;
    const oz = a.pz;
    const ak = ackSeq % SOLO_PREDICTION_HISTORY;
    let err = -1;
    if (this.histSeq[ak] === (ackSeq & 0xffff)) {
      const h = this.hist[ak]!;
      const dx = h.px - self.px;
      const dy = h.py - self.py;
      const dz = h.pz - self.pz;
      err = Math.sqrt(dx * dx + dy * dy + dz * dz);
      copyAvatar(h, a);
      this.prevButtons = this.prevButtonsAfter[ak]!;
    } else {
      this.stats.unknownAcks++;
    }
    applySelf(self, a);
    let n = (this.lastSeq - ackSeq) & 0xffff;
    if (n > 0x8000) n = 0;
    let from = (ackSeq + 1) & 0xffff;
    if (n > SOLO_PREDICTION_MAX_REPLAY) {
      this.stats.replayCapped++;
      from = (this.lastSeq - SOLO_PREDICTION_MAX_REPLAY + 1) & 0xffff;
      n = SOLO_PREDICTION_MAX_REPLAY;
    }
    for (let i = 0; i < n; i++) {
      const seq = (from + i) & 0xffff;
      const k = seq % SOLO_PREDICTION_HISTORY;
      if (this.histSeq[k] !== seq) continue;
      this.stepSlot(k);
      this.prevButtonsAfter[k] = this.prevButtons;
      copyAvatar(a, this.hist[k]!);
    }
    this.stats.replayed += n;
    this.stats.reconciles++;
    if (err >= 0) {
      this.stats.lastCorrectionM = err;
      if (err > this.stats.maxCorrectionM) this.stats.maxCorrectionM = err;
    }
    const o = this.offset;
    o[0] = o[0]! + ox - a.px;
    o[1] = o[1]! + oy - a.py;
    o[2] = o[2]! + oz - a.pz;
  }

  /** Render pose: newest predicted tick + velocity x time since it (<= 1 tick) + decaying correction offset. */
  sample(t: { readonly nowMs: number }, out: Float64Array): boolean {
    if (!this.started) return false;
    const nowMs = t.nowMs;
    const o = this.offset;
    const decayDt = nowMs - this.lastDecayMs;
    this.lastDecayMs = nowMs;
    if (decayDt > 0 && (o[0] !== 0 || o[1] !== 0 || o[2] !== 0)) {
      const f = Math.pow(0.5, decayDt / SOLO_CORRECTION_HALF_LIFE_MS);
      o[0] = Math.abs(o[0]! * f) < 1e-5 ? 0 : o[0]! * f;
      o[1] = Math.abs(o[1]! * f) < 1e-5 ? 0 : o[1]! * f;
      o[2] = Math.abs(o[2]! * f) < 1e-5 ? 0 : o[2]! * f;
    }
    const a = this.state;
    out[0] = a.px + o[0]!;
    out[1] = a.py + o[1]!;
    out[2] = a.pz + o[2]!;
    if (!this.speculate) return true;
    let f = (nowMs - this.stepMs) / this.tickMs;
    f = f < 0 ? 0 : f > 1 ? 1 : f;
    if (f === 0) return true;
    const sp = this.spec;
    copyAvatar(a, sp);
    const L = this.live;
    const saved = this.prevButtons;
    this.stepWith(sp, L.moveX, L.moveY, L.yaw, L.buttons);
    this.prevButtons = saved;
    out[0] = out[0]! + (sp.px - a.px) * f;
    out[1] = out[1]! + (sp.py - a.py) * f;
    out[2] = out[2]! + (sp.pz - a.pz) * f;
    return true;
  }

  private stepSlot(k: number): void {
    this.stepWith(this.state, this.inMoveX[k]!, this.inMoveY[k]!, this.inYaw[k]!, this.inButtons[k]!);
  }

  /** stepActor's movement half (moon-room-sim.ts); identical to the online predictor's. Integer arguments only. */
  private stepWith(a: AvatarState, moveX: number, moveY: number, yaw: number, b: number): void {
    if (this.seated) {
      this.prevButtons = b;
      return;
    }
    const cfg = this.cfg;
    const M = INPUT_BUTTON_MASK;
    const pressed = b & ~this.prevButtons;
    const released = this.prevButtons & ~b;
    const tool = cfg.tools[this.toolCode];
    const canWork = tool !== undefined && tool.cleans && a.moveLockTicks === 0;
    const detailing = canWork && tool.detailing && (b & M.toolSecondary) !== 0;
    const sweeping = canWork && !detailing && (b & M.toolPrimary) !== 0;
    const laneLocked = sweeping && (b & M.laneLock) !== 0;
    const mi = this.intent;
    let mx = moveX / INPUT_AXIS_MAX;
    let my = moveY / INPUT_AXIS_MAX;
    const ml = Math.sqrt(mx * mx + my * my);
    if (ml > 1) {
      mx /= ml;
      my /= ml;
    }
    mi.moveX = mx;
    mi.moveY = my;
    mi.yaw = yaw;
    mi.jumpPressed = (pressed & M.jump) !== 0;
    mi.jumpHeld = (b & M.jump) !== 0;
    mi.jumpReleased = (released & M.jump) !== 0;
    mi.hopPressed = (pressed & M.hopPack) !== 0;
    mi.lope = (b & M.lope) !== 0;
    mi.descend = (b & M.descend) !== 0;
    mi.sweeping = sweeping || detailing;
    mi.faceAim = sweeping || detailing;
    let speedMult = detailing ? cfg.toolFeel.detailingSpeedMult : laneLocked ? tool!.laneLockBonus : 1;
    // Steep rule, same as stepActor: sweeping (not Detailing) on ground steeper than world.steepSlopeDeg runs at the
    // tool's Steep multiplier; the probe is skipped when the multiplier is 1 (Sure Footing / Charge).
    if (sweeping && tool!.steepSweepMult !== 1) {
      groundSlopeTan(a, cfg, this.ground, this.slopeOut);
      if (this.slopeOut[0]! > cfg.tanSteepSlope) speedMult *= tool!.steepSweepMult;
    }
    mi.speedMult = speedMult;
    stepAvatar(a, mi, cfg, this.ground);
    this.prevButtons = b;
  }
}

function applySelf(self: SelfLike, a: AvatarState): void {
  a.px = self.px;
  a.py = self.py;
  a.pz = self.pz;
  a.vx = self.vx;
  a.vy = self.vy;
  a.vz = self.vz;
  a.moveState = self.moveState;
  a.hopCharges = self.hopCharges;
}
