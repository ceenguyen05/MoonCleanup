// Own-avatar prediction with reconciliation for online rooms (M1-W4-T04, netcode.md section 5).
//
// The client steps its own avatar with the SAME `stepAvatar` the server runs (packages/sim), from the same inputs, so
// at 120 ms RTT the avatar answers the stick at once. Every FRAME carries the authoritative Self after the server
// consumed input `ackInputSeq`; `reconcile` then:
//   1. restores the predicted state recorded after that input (timers, facing, frame bit that Self does not carry),
//   2. overwrites what Self carries (position, velocity, move state, hop charges), measures the correction,
//   3. replays the unacknowledged inputs (at most `maxReplay`, default 16) to get back to the present,
//   4. keeps the visual jump as a render offset that decays (no snapping on screen).
// The MoveIntent is derived exactly like MoonRoomSim.stepActor (holster/swap timers are not predicted: tool changes
// come through Schema, `setTool`). Allocation-free after construction: the history is a ring of preallocated states.
//
// SOLO FIRST: constructed only for an online room. Solo uses the LocalRoom host and never imports this file.

import { INPUT_AXIS_MAX, INPUT_BUTTON_MASK } from "@moon-cleanup/shared";
import type { SelfState } from "@moon-cleanup/protocol";
import {
  AvatarState,
  MoveIntent,
  groundSlopeTan,
  headingBasis,
  stepAvatar,
  type SimConfig,
  type SimGround,
} from "@moon-cleanup/sim";

/** Most inputs replayed per reconcile (W4-T04 budget: <= 16 inputs, <= 0.5 ms on device A). */
export const PREDICTION_MAX_REPLAY = 16;
/** History ring (inputs kept for replay): 64 ticks = 3.2 s at 20 Hz, far beyond any RTT the session keeps. */
export const PREDICTION_HISTORY = 64;
/** Render offset half-life after a correction (ms). */
export const CORRECTION_HALF_LIFE_MS = 80;

/** The input fields prediction reads (an encoded INPUT's decoded form). */
export interface PredictInput {
  seq: number;
  moveX: number;
  moveY: number;
  yaw: number;
  buttons: number;
}

// Unrolled on purpose: a keyed loop (`dst[k] = src[k]` over a name list) is a megamorphic keyed access that boxes every
// double it moves (measured GC-anchored, M1 net round 3); named stores are monomorphic. Same field set as before:
// position, velocity, facing, timers, hop pack, recovery, locks, flags, last landing.
function copyAvatar(src: AvatarState, dst: AvatarState): void {
  dst.px = src.px;
  dst.py = src.py;
  dst.pz = src.pz;
  dst.vx = src.vx;
  dst.vy = src.vy;
  dst.vz = src.vz;
  dst.fx = src.fx;
  dst.fy = src.fy;
  dst.fz = src.fz;
  dst.yawFrame = src.yawFrame;
  dst.moveState = src.moveState;
  dst.heightAboveGround = src.heightAboveGround;
  dst.coyoteTicks = src.coyoteTicks;
  dst.jumpBufferTicks = src.jumpBufferTicks;
  dst.snapOffTicks = src.snapOffTicks;
  dst.hopCharges = src.hopCharges;
  dst.hopMaxCharges = src.hopMaxCharges;
  dst.hopRechargeTicks = src.hopRechargeTicks;
  dst.hopIntervalTicks = src.hopIntervalTicks;
  dst.recoverTicks = src.recoverTicks;
  dst.recoverAccelMult = src.recoverAccelMult;
  dst.moveLockTicks = src.moveLockTicks;
  dst.jumpLockTicks = src.jumpLockTicks;
  dst.airSpeedCap = src.airSpeedCap;
  dst.plotHint = src.plotHint;
  dst.active = src.active;
  dst.jumpCutUsed = src.jumpCutUsed;
  dst.jumped = src.jumped;
  dst.touchdown = src.touchdown;
  dst.lastLanding = src.lastLanding;
  dst.lastImpactMps = src.lastImpactMps;
}

export interface PredictorStats {
  reconciles: number;
  replayed: number;
  replayCapped: number;
  /** Ack seqs with no recorded prediction (server substituted, or history too old). */
  unknownAcks: number;
  /** Last correction distance (m) between the prediction for the acked input and the server. */
  lastCorrectionM: number;
}

export class OwnAvatarPredictor {
  /** The predicted present (what the camera and the avatar mesh follow, plus `offset`). */
  readonly state = new AvatarState();
  /** Visual correction offset (m), added to the rendered position and decayed by `decay`. */
  readonly offset = new Float64Array(3);
  readonly stats: PredictorStats = { reconciles: 0, replayed: 0, replayCapped: 0, unknownAcks: 0, lastCorrectionM: 0 };
  private readonly cfg: SimConfig;
  private readonly ground: SimGround;
  private readonly maxReplay: number;
  private readonly intent = new MoveIntent();
  private readonly basis = new Float64Array(9);
  /** groundSlopeTan output (Steep rule); reused, no per-step allocation. */
  private readonly slopeOut = new Float64Array(1);
  /** Ring: input and the predicted state AFTER it, by seq (mod PREDICTION_HISTORY). */
  private readonly hist: AvatarState[] = [];
  private readonly histSeq = new Int32Array(PREDICTION_HISTORY).fill(-1);
  private readonly inMoveX = new Int16Array(PREDICTION_HISTORY);
  private readonly inMoveY = new Int16Array(PREDICTION_HISTORY);
  private readonly inYaw = new Uint16Array(PREDICTION_HISTORY);
  private readonly inButtons = new Uint16Array(PREDICTION_HISTORY);
  private readonly prevButtonsAfter = new Uint16Array(PREDICTION_HISTORY);
  private prevButtons = 0;
  private lastSeq = -1;
  private toolCode = 0;
  private started = false;

  constructor(cfg: SimConfig, ground: SimGround, maxReplay: number = PREDICTION_MAX_REPLAY) {
    this.cfg = cfg;
    this.ground = ground;
    this.maxReplay = Math.max(1, Math.min(maxReplay, PREDICTION_HISTORY - 1));
    for (let i = 0; i < PREDICTION_HISTORY; i++) this.hist.push(new AvatarState());
  }

  get ready(): boolean {
    return this.started;
  }

  /** Equipped tool code (Schema `equippedTool`): speed multipliers and face-aim follow it. */
  setTool(toolCode: number): void {
    this.toolCode = toolCode;
  }

  /** Starts from the first authoritative Self (join or resync keyframe). `hopMaxCharges` from the suit gear. */
  start(self: Readonly<SelfState>, ackSeq: number, hopMaxCharges = 0): void {
    const a = this.state;
    a.active = true;
    a.hopMaxCharges = hopMaxCharges;
    this.applySelf(self, a);
    headingBasis(a, this.basis);
    a.fx = this.basis[3]!;
    a.fy = this.basis[4]!;
    a.fz = this.basis[5]!;
    this.histSeq.fill(-1);
    this.lastSeq = ackSeq & 0xffff;
    this.offset.fill(0);
    this.started = true;
  }

  /** One local tick with the input just sent to the server. Allocation-free. */
  predict(input: Readonly<PredictInput>): void {
    if (!this.started) return;
    const k = input.seq % PREDICTION_HISTORY;
    this.inMoveX[k] = input.moveX;
    this.inMoveY[k] = input.moveY;
    this.inYaw[k] = input.yaw;
    this.inButtons[k] = input.buttons;
    this.stepWith(k);
    this.prevButtonsAfter[k] = this.prevButtons;
    copyAvatar(this.state, this.hist[k]!);
    this.histSeq[k] = input.seq & 0xffff;
    this.lastSeq = input.seq & 0xffff;
  }

  /**
   * Authoritative Self after input `ackSeq`. Returns the correction (m) at that input, or -1 when the ack has no
   * recorded prediction (the state then restarts from Self and replays from there).
   */
  reconcile(self: Readonly<SelfState>, ackSeq: number): number {
    if (!this.started) return -1;
    const a = this.state;
    const ox = a.px;
    const oy = a.py;
    const oz = a.pz;
    const ak = ackSeq % PREDICTION_HISTORY;
    let err = -1;
    if (this.histSeq[ak] === (ackSeq & 0xffff)) {
      const h = this.hist[ak]!;
      err = Math.sqrt((h.px - self.px) ** 2 + (h.py - self.py) ** 2 + (h.pz - self.pz) ** 2);
      copyAvatar(h, a);
      this.prevButtons = this.prevButtonsAfter[ak]!;
    } else {
      this.stats.unknownAcks++;
    }
    this.applySelf(self, a);
    // Replay ackSeq+1 .. lastSeq (16-bit wrap), at most maxReplay of the newest.
    let n = (this.lastSeq - ackSeq) & 0xffff;
    if (n > 0x8000) n = 0; // ack ahead of our sends: nothing to replay
    let from = (ackSeq + 1) & 0xffff;
    if (n > this.maxReplay) {
      this.stats.replayCapped++;
      from = (this.lastSeq - this.maxReplay + 1) & 0xffff;
      n = this.maxReplay;
    }
    for (let i = 0; i < n; i++) {
      const seq = (from + i) & 0xffff;
      const k = seq % PREDICTION_HISTORY;
      if (this.histSeq[k] !== seq) continue;
      this.stepWith(k);
      this.prevButtonsAfter[k] = this.prevButtons;
      copyAvatar(a, this.hist[k]!);
    }
    this.stats.replayed += n;
    this.stats.reconciles++;
    if (err >= 0) this.stats.lastCorrectionM = err;
    // Keep the screen continuous: what moved because of the correction becomes a decaying offset.
    this.offset[0] = this.offset[0]! + ox - a.px;
    this.offset[1] = this.offset[1]! + oy - a.py;
    this.offset[2] = this.offset[2]! + oz - a.pz;
    return err;
  }

  /** Decays the render offset; call once per render frame with the frame time. */
  decay(dtMs: number): void {
    const f = Math.pow(0.5, dtMs / CORRECTION_HALF_LIFE_MS);
    const o = this.offset;
    o[0] = o[0]! * f;
    o[1] = o[1]! * f;
    o[2] = o[2]! * f;
  }

  private applySelf(self: Readonly<SelfState>, a: AvatarState): void {
    a.px = self.px;
    a.py = self.py;
    a.pz = self.pz;
    a.vx = self.vx;
    a.vy = self.vy;
    a.vz = self.vz;
    a.moveState = self.moveState;
    a.hopCharges = self.hopCharges;
  }

  /** stepActor's movement half (moon-room-sim.ts), from history slot `k`. */
  private stepWith(k: number): void {
    const a = this.state;
    const cfg = this.cfg;
    const M = INPUT_BUTTON_MASK;
    const b = this.inButtons[k]!;
    const pressed = b & ~this.prevButtons;
    const released = this.prevButtons & ~b;
    const tool = cfg.tools[this.toolCode];
    const canWork = tool !== undefined && tool.cleans && a.moveLockTicks === 0;
    const detailing = canWork && tool.detailing && (b & M.toolSecondary) !== 0;
    const sweeping = canWork && !detailing && (b & M.toolPrimary) !== 0;
    const laneLocked = sweeping && (b & M.laneLock) !== 0;
    const mi = this.intent;
    let mx = this.inMoveX[k]! / INPUT_AXIS_MAX;
    let my = this.inMoveY[k]! / INPUT_AXIS_MAX;
    const ml = Math.sqrt(mx * mx + my * my);
    if (ml > 1) {
      mx /= ml;
      my /= ml;
    }
    mi.moveX = mx;
    mi.moveY = my;
    mi.yaw = this.inYaw[k]!;
    mi.jumpPressed = (pressed & M.jump) !== 0;
    mi.jumpHeld = (b & M.jump) !== 0;
    mi.jumpReleased = (released & M.jump) !== 0;
    mi.hopPressed = (pressed & M.hopPack) !== 0;
    mi.lope = (b & M.lope) !== 0;
    mi.descend = (b & M.descend) !== 0;
    mi.sweeping = sweeping || detailing;
    mi.faceAim = sweeping || detailing;
    let speedMult = detailing ? cfg.toolFeel.detailingSpeedMult : laneLocked ? tool!.laneLockBonus : 1;
    // Steep rule, same as stepActor and SoloPredictor: sweeping (not Detailing) on ground steeper than
    // world.steepSlopeDeg runs at the tool's Steep multiplier; the probe is skipped when the multiplier is 1 (Sure
    // Footing / Charge). Measured before the move, into a reused buffer.
    if (sweeping && tool!.steepSweepMult !== 1) {
      groundSlopeTan(a, cfg, this.ground, this.slopeOut);
      if (this.slopeOut[0]! > cfg.tanSteepSlope) speedMult *= tool!.steepSweepMult;
    }
    mi.speedMult = speedMult;
    stepAvatar(a, mi, cfg, this.ground);
    this.prevButtons = b;
  }
}
