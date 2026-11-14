// Interpolation buffer for remote entities (netcode.md section 6). Pure TypeScript; no clock of its own.
//
// What it does
//   - `ingest(view)` takes a decoded FRAME (FrameView) and appends one sample per entity record to that slot's
//     fixed-size ring (32 samples per slot by default). Samples carry the SERVER time of the frame
//     (serverTick * tickMs); out-of-order and duplicate samples are rejected per slot (equal time overwrites the
//     newest sample, older time is dropped and counted).
//   - `update()` advances the render timeline. It is driven by the local clock written into `io[IO_NOW]` and the
//     clock offset of `ClockSync`: the render time chases `localNow + arrivalOffset - delay`. The delay target is
//     `clamp(1.5 * snapshotInterval + 2 * jitterP95, 150, 250)` ms (start 200), jitterP95 being the p95 of the
//     frame inter-arrival deviation over the last 64 frames. The timeline is SLEWED, never jumped: its rate is
//     clamped to 0.97 .. 1.03 (error / 1000 ms), except when the error exceeds 1000 ms (hidden tab, suspended
//     laptop, server restart), which snaps once and is counted.
//   - `sample(slot)` writes the interpolated state of one slot into `result[slot * RESULT_STRIDE ...]` and returns a
//     status: linear position and shortest-arc yaw (avatars, robots); cubic Hermite position from finite-difference
//     tangents and quaternion slerp (vehicles). Past the newest sample it extrapolates with the last velocity for
//     up to 250 ms, then holds; after 1 s it reports SAMPLE_SIGNAL_LOST (the UI flags the entity).
//
// Time model: `ClockSync.offsetMs` maps local time to server time at the moment a frame is stamped plus the one-way
// latency; the buffer uses `arrivalOffset = offsetMs - rttMs / 2`, the server time of data that arrives right now, so
// `delay` is exactly how far behind the newest data the renderer plays (what the section 6 formula sizes).
//
// Allocation: every table is allocated once in the constructor. `ingest`, `update` and `sample` allocate nothing:
// doubles go in through `io` (a Float64Array store, not a call argument) or live in typed arrays and fields, and the
// hot arithmetic is inline (a double passed to a call V8 does not inline is boxed, 16 B per call).
//
// Discrete (non-interpolated) fields ride in two int32 words per sample (`discrete[slot * 2 + 0|1]`), taken from the
// older sample of the bracket:
//   avatar : word0 = actionState | toolIndex << 6 | flags << 10 | pitchCode << 16 ; word1 = 0
//   vehicle: word0 = flags | speedCode << 8 | (steerCode & 63) << 16             ; word1 = driverSlot
//   robot  : word0 = robotState | cargo << 4                                      ; word1 = 0

import { QUANT } from "@moon-cleanup/shared";
import {
  ENTITY_KIND_AVATAR,
  ENTITY_KIND_ROBOT,
  ENTITY_KIND_VEHICLE,
  REC_REMOVE,
  SLOT_OP_ASSIGN,
  SLOT_OP_RELEASE,
  type FrameView,
} from "../codec/frame-state";
import { unpackQuat, type QuatOut } from "../codec/quantize";
import { ClockSync } from "./clock-sync";

// ---- constants -----------------------------------------------------------------------------------------------------

/** Index of the local clock (ms) in `io`. */
export const IO_NOW = 0;

/** Result layout per slot: px, py, pz, yaw (rad), qx, qy, qz, qw. */
export const RESULT_STRIDE = 8;
export const R_PX = 0;
export const R_PY = 1;
export const R_PZ = 2;
export const R_YAW = 3;
export const R_QX = 4;
export const R_QY = 5;
export const R_QZ = 6;
export const R_QW = 7;

export const SAMPLE_NONE = 0;
export const SAMPLE_OK = 1;
export const SAMPLE_EXTRAPOLATING = 2;
export const SAMPLE_HOLD = 3;
export const SAMPLE_SIGNAL_LOST = 4;
/** Render time is older than the oldest sample: the oldest sample is held. */
export const SAMPLE_BEFORE = 5;

export const MODE_LINEAR = 0;
export const MODE_HERMITE = 1;

export const PUSH_OK = 0;
export const PUSH_DUPLICATE = 1;
export const PUSH_STALE = 2;

export const DELAY_MIN_MS = 150;
export const DELAY_MAX_MS = 250;
export const DELAY_START_MS = 200;
export const RATE_MIN = 0.97;
export const RATE_MAX = 1.03;
/** Error (ms) divided by this gives the rate offset before clamping. */
export const SLEW_HORIZON_MS = 1000;
/** Timeline error above which the render time snaps instead of slewing. */
export const SNAP_THRESHOLD_MS = 1000;
export const EXTRAPOLATE_MAX_MS = 250;
export const SIGNAL_LOST_MS = 1000;
export const JITTER_WINDOW = 64;
export const DEFAULT_CAPACITY = 32;

const TWO_PI = Math.PI * 2;
const YAW_RAD_PER_CODE = TWO_PI / QUANT.yaw.steps;
const HEADING_RAD_PER_CODE = TWO_PI / 256;
const QUAT_BITS = QUANT.vehicleOrientation.componentBits;
const NO_KIND = 255;

export interface InterpolationOptions {
  /** Highest slot count (the slot table has 255). */
  maxSlots?: number;
  /** Samples per slot; a power of two (default 32). */
  capacity?: number;
  simTickHz?: number;
  snapshotHz?: number;
  /** Shared clock (default: a private ClockSync). */
  clock?: ClockSync;
}

// ---- discrete word helpers (pure int math) --------------------------------------------------------------------------

export function avatarActionState(word0: number): number {
  return word0 & 63;
}
export function avatarToolIndex(word0: number): number {
  return (word0 >>> 6) & 15;
}
export function avatarFlags(word0: number): number {
  return (word0 >>> 10) & 63;
}
export function avatarPitchCode(word0: number): number {
  return (word0 >>> 16) & 63;
}
export function vehicleFlags(word0: number): number {
  return word0 & 255;
}
export function vehicleSpeedCode(word0: number): number {
  return (word0 >>> 8) & 255;
}
/** Signed 6-bit steering code (-32 .. 31). */
export function vehicleSteerCode(word0: number): number {
  return (((word0 >>> 16) & 63) << 26) >> 26;
}
export function robotState(word0: number): number {
  return word0 & 15;
}
export function robotCargo(word0: number): number {
  return (word0 >>> 4) & 7;
}

// ---- buffer --------------------------------------------------------------------------------------------------------

export class InterpolationBuffer {
  /** Input cells: `io[IO_NOW]` = local clock in ms. Write it, then call `update()` / `ingest()`. */
  readonly io = new Float64Array(2);
  /** Interpolated state per slot, `RESULT_STRIDE` doubles each (see R_*). */
  readonly result: Float64Array;
  /** Discrete words per slot, two int32 each. */
  readonly discrete: Int32Array;
  /** Status of the last `sample(slot)`. */
  readonly status: Uint8Array;
  readonly clock: ClockSync;
  readonly maxSlots: number;
  readonly capacity: number;

  /** Render timeline, server ms. Valid once `started`. */
  renderTimeMs = 0;
  started = false;
  /** Current delay target, ms (section 6 formula). */
  targetDelayMs = DELAY_START_MS;
  /** p95 of the frame inter-arrival deviation over the last JITTER_WINDOW frames, ms. */
  jitterP95Ms = 0;
  /** Frames ingested since the last `resetAll`. */
  framesIngested = 0;
  /** Samples appended / dropped as stale or duplicate-ignored / timeline snaps. */
  samplesPushed = 0;
  samplesStale = 0;
  samplesDuplicate = 0;
  timelineSnaps = 0;
  /** Playback rate used by the last `update()`. */
  playbackRate = 1;

  private tickMs: number;
  private snapshotIntervalMs: number;
  private readonly mask: number;
  private readonly times: Float64Array;
  private readonly vals: Float64Array;
  private readonly head: Uint8Array;
  private readonly count: Uint8Array;
  private readonly kind: Uint8Array;
  private readonly mode: Uint8Array;
  private readonly quat: QuatOut = { x: 0, y: 0, z: 0, w: 1 };

  // jitter tracking
  private readonly devs = new Float64Array(JITTER_WINDOW);
  private readonly sorted = new Float64Array(JITTER_WINDOW);
  private devCount = 0;
  private devHead = 0;
  private devSinceSort = 0;
  private haveLastArrival = false;
  private lastArrivalMs = 0;
  private lastArrivalTick = 0;

  // frame being ingested (fields instead of call arguments: no boxing)
  private frameTimeMs = 0;
  private lastLocalMs = 0;

  constructor(options: InterpolationOptions = {}) {
    const maxSlots = options.maxSlots ?? 255;
    const capacity = options.capacity ?? DEFAULT_CAPACITY;
    if (!Number.isInteger(capacity) || capacity < 4 || capacity > 128 || (capacity & (capacity - 1)) !== 0) {
      throw new RangeError("capacity must be a power of two in 4 .. 128");
    }
    if (!Number.isInteger(maxSlots) || maxSlots < 1 || maxSlots > 255)
      throw new RangeError("maxSlots must be 1 .. 255");
    this.maxSlots = maxSlots;
    this.capacity = capacity;
    this.mask = capacity - 1;
    const simTickHz = options.simTickHz ?? 20;
    const snapshotHz = options.snapshotHz ?? 10;
    this.clock = options.clock ?? new ClockSync(1000 / simTickHz);
    this.tickMs = 1000 / simTickHz;
    this.snapshotIntervalMs = 1000 / snapshotHz;
    this.clock.tickMs = this.tickMs;
    this.times = new Float64Array(maxSlots * capacity);
    this.vals = new Float64Array(maxSlots * capacity * RESULT_STRIDE);
    this.discreteStore = new Int32Array(maxSlots * capacity * 2);
    this.head = new Uint8Array(maxSlots);
    this.count = new Uint8Array(maxSlots);
    this.kind = new Uint8Array(maxSlots).fill(NO_KIND);
    this.mode = new Uint8Array(maxSlots);
    this.result = new Float64Array(maxSlots * RESULT_STRIDE);
    this.discrete = new Int32Array(maxSlots * 2);
    this.status = new Uint8Array(maxSlots);
    this.updateTarget();
  }

  /** Sample-time discrete words (ring storage). */
  private readonly discreteStore: Int32Array;

  /** Applies the room rates of the hello. Keeps the ring contents. */
  configure(simTickHz: number, snapshotHz: number): void {
    if (simTickHz > 0) {
      this.tickMs = 1000 / simTickHz;
      this.clock.tickMs = this.tickMs;
    }
    if (snapshotHz > 0) this.snapshotIntervalMs = 1000 / snapshotHz;
    this.updateTarget();
  }

  /** Clears every slot and the timeline (join, resync, reconnect). The clock estimate is kept. */
  resetAll(): void {
    this.count.fill(0);
    this.head.fill(0);
    this.kind.fill(NO_KIND);
    this.status.fill(SAMPLE_NONE);
    this.started = false;
    this.framesIngested = 0;
    this.haveLastArrival = false;
    this.devCount = 0;
    this.devHead = 0;
    this.devSinceSort = 0;
    this.jitterP95Ms = 0;
    this.targetDelayMs = DELAY_START_MS;
    this.updateTarget();
  }

  /** Clears one slot (assign / release / remove). */
  resetSlot(slot: number): void {
    if (slot < 0 || slot >= this.maxSlots) return;
    this.count[slot] = 0;
    this.head[slot] = 0;
    this.kind[slot] = NO_KIND;
    this.status[slot] = SAMPLE_NONE;
  }

  /** Samples currently stored for `slot`. */
  sampleCount(slot: number): number {
    return slot >= 0 && slot < this.maxSlots ? (this.count[slot] ?? 0) : 0;
  }

  // ---- ingest ------------------------------------------------------------------------------------------------------

  /**
   * Appends the entity records of a decoded frame. Call after `FrameReader.decode` returned OK and after writing the
   * local clock to `io[IO_NOW]`. Slot changes reset their slots first; REMOVE records reset the slot.
   */
  ingest(view: FrameView): void {
    const tick = view.serverTick;
    this.frameTimeMs = tick * this.tickMs;
    this.noteArrival(tick);
    this.clock.provisionalFromFrame(tick, this.io[IO_NOW] ?? 0);
    this.framesIngested++;

    const changes = view.slotChanges;
    for (let i = 0; i < changes.count; i++) {
      const op = changes.op[i];
      if (op === SLOT_OP_ASSIGN || op === SLOT_OP_RELEASE) this.resetSlot(changes.slot[i] ?? 0);
    }
    const n = view.entityCount;
    const entities = view.entities;
    for (let i = 0; i < n; i++) {
      const e = entities[i];
      if (e === undefined) break;
      const slot = e.slot;
      if (slot >= this.maxSlots) continue;
      if (e.rec === REC_REMOVE) {
        this.resetSlot(slot);
        continue;
      }
      const kind = e.kind;
      if (kind !== ENTITY_KIND_AVATAR && kind !== ENTITY_KIND_VEHICLE && kind !== ENTITY_KIND_ROBOT) continue;
      if (this.kind[slot] !== kind) {
        // A slot reused for another kind without a slot change in between: start clean.
        this.resetSlot(slot);
        this.kind[slot] = kind;
        this.mode[slot] = kind === ENTITY_KIND_VEHICLE ? MODE_HERMITE : MODE_LINEAR;
      }
      const t = this.frameTimeMs;
      const base = slot * this.capacity;
      const n0 = this.count[slot] ?? 0;
      const h0 = this.head[slot] ?? 0;
      let at: number;
      if (n0 > 0) {
        const newest = this.times[base + ((h0 - 1) & this.mask)] ?? 0;
        if (t < newest) {
          this.samplesStale++;
          continue;
        }
        if (t === newest) {
          this.samplesDuplicate++;
          at = (h0 - 1) & this.mask;
        } else {
          at = h0;
          this.head[slot] = (h0 + 1) & this.mask;
          if (n0 < this.capacity) this.count[slot] = n0 + 1;
        }
      } else {
        at = h0;
        this.head[slot] = (h0 + 1) & this.mask;
        this.count[slot] = 1;
      }
      const idx = base + at;
      this.times[idx] = t;
      const o = idx * RESULT_STRIDE;
      const vals = this.vals;
      vals[o] = e.px;
      vals[o + 1] = e.py;
      vals[o + 2] = e.pz;
      let d0 = 0;
      let d1 = 0;
      if (kind === ENTITY_KIND_AVATAR) {
        vals[o + 3] = e.yawCode * YAW_RAD_PER_CODE;
        vals[o + 4] = 0;
        vals[o + 5] = 0;
        vals[o + 6] = 0;
        vals[o + 7] = 1;
        d0 = (e.actionState & 63) | ((e.toolIndex & 15) << 6) | ((e.flags & 63) << 10) | ((e.pitchCode & 63) << 16);
      } else if (kind === ENTITY_KIND_VEHICLE) {
        const q = unpackQuat(e.orientIndex, e.orientA, e.orientB, e.orientC, QUAT_BITS, this.quat);
        vals[o + 3] = 0;
        vals[o + 4] = q.x;
        vals[o + 5] = q.y;
        vals[o + 6] = q.z;
        vals[o + 7] = q.w;
        d0 = (e.flags & 255) | ((e.speedCode & 255) << 8) | ((e.steerCode & 63) << 16);
        d1 = e.driverSlot & 255;
      } else {
        vals[o + 3] = e.headingCode * HEADING_RAD_PER_CODE;
        vals[o + 4] = 0;
        vals[o + 5] = 0;
        vals[o + 6] = 0;
        vals[o + 7] = 1;
        d0 = (e.robotState & 15) | ((e.cargo & 7) << 4);
      }
      this.discreteStore[idx * 2] = d0;
      this.discreteStore[idx * 2 + 1] = d1;
      this.samplesPushed++;
    }
  }

  /** Jitter bookkeeping of one frame arrival (uses `io[IO_NOW]` and `frameTimeMs`). */
  private noteArrival(tick: number): void {
    const now = this.io[IO_NOW] ?? 0;
    if (this.haveLastArrival) {
      const dTicks = (tick - this.lastArrivalTick) | 0;
      if (dTicks > 0) {
        const dev = Math.abs(now - this.lastArrivalMs - dTicks * this.tickMs);
        this.devs[this.devHead] = dev;
        this.devHead = (this.devHead + 1) % JITTER_WINDOW;
        if (this.devCount < JITTER_WINDOW) this.devCount++;
        this.devSinceSort++;
        if (this.devSinceSort >= 8 && this.devCount >= 8) {
          this.devSinceSort = 0;
          this.recomputeJitter();
        }
        this.lastArrivalMs = now;
        this.lastArrivalTick = tick;
      }
      // dTicks <= 0: a duplicate or old frame must not move the reference (the session drops those before ingest).
    } else {
      this.haveLastArrival = true;
      this.lastArrivalMs = now;
      this.lastArrivalTick = tick;
    }
  }

  private recomputeJitter(): void {
    const n = this.devCount;
    const s = this.sorted;
    for (let i = 0; i < n; i++) {
      const v = this.devs[i] ?? 0;
      let j = i - 1;
      while (j >= 0 && (s[j] ?? 0) > v) {
        s[j + 1] = s[j] ?? 0;
        j--;
      }
      s[j + 1] = v;
    }
    const k = Math.max(0, Math.ceil(0.95 * n) - 1);
    this.jitterP95Ms = s[k] ?? 0;
    this.updateTarget();
  }

  private updateTarget(): void {
    // Until 8 inter-arrival samples exist the jitter is unknown: start at 200 ms (section 6).
    if (this.devCount < 8) {
      this.targetDelayMs = DELAY_START_MS;
      return;
    }
    const t = 1.5 * this.snapshotIntervalMs + 2 * this.jitterP95Ms;
    this.targetDelayMs = t < DELAY_MIN_MS ? DELAY_MIN_MS : t > DELAY_MAX_MS ? DELAY_MAX_MS : t;
  }

  // ---- timeline ----------------------------------------------------------------------------------------------------

  /**
   * Advances the render timeline to the local clock in `io[IO_NOW]`. Does nothing until a frame and a clock estimate
   * exist. The first call places the timeline at the target delay (start 200 ms); later calls slew it.
   */
  update(): void {
    const now = this.io[IO_NOW] ?? 0;
    const clock = this.clock;
    if (this.framesIngested === 0 || !clock.hasEstimate) return;
    const target = now + (clock.offsetMs - clock.rttMs * 0.5) - this.targetDelayMs;
    if (!this.started) {
      this.renderTimeMs = target;
      this.started = true;
      this.lastLocalMs = now;
      this.playbackRate = 1;
      return;
    }
    let dt = now - this.lastLocalMs;
    this.lastLocalMs = now;
    if (dt < 0) dt = 0;
    const err = target - this.renderTimeMs;
    if (err > SNAP_THRESHOLD_MS || err < -SNAP_THRESHOLD_MS) {
      this.renderTimeMs = target;
      this.timelineSnaps++;
      this.playbackRate = 1;
      return;
    }
    let rate = 1 + err / SLEW_HORIZON_MS;
    rate = rate < RATE_MIN ? RATE_MIN : rate > RATE_MAX ? RATE_MAX : rate;
    this.playbackRate = rate;
    this.renderTimeMs += dt * rate;
  }

  // ---- sampling ----------------------------------------------------------------------------------------------------

  /**
   * Writes the state of `slot` at the render time into `result[slot * RESULT_STRIDE ...]` and
   * `discrete[slot * 2 ...]`. Returns SAMPLE_* (also stored in `status[slot]`). SAMPLE_NONE leaves the result as is.
   */
  sample(slot: number): number {
    if (slot < 0 || slot >= this.maxSlots || !this.started) return SAMPLE_NONE;
    const n = this.count[slot] ?? 0;
    if (n === 0) {
      this.status[slot] = SAMPLE_NONE;
      return SAMPLE_NONE;
    }
    const cap = this.capacity;
    const mask = this.mask;
    const base = slot * cap;
    const h = this.head[slot] ?? 0;
    const times = this.times;
    const vals = this.vals;
    const out = this.result;
    const ro = slot * RESULT_STRIDE;
    const render = this.renderTimeMs;
    const hermite = this.mode[slot] === MODE_HERMITE;

    const iNew = base + ((h - 1) & mask);
    const tNew = times[iNew] ?? 0;
    let status: number;

    if (render >= tNew) {
      // newest sample reached: extrapolate with the last velocity, then hold
      const oN = iNew * RESULT_STRIDE;
      let ex = render - tNew;
      status = SAMPLE_OK;
      if (ex > 0) {
        status =
          ex > SIGNAL_LOST_MS ? SAMPLE_SIGNAL_LOST : ex > EXTRAPOLATE_MAX_MS ? SAMPLE_HOLD : SAMPLE_EXTRAPOLATING;
        if (ex > EXTRAPOLATE_MAX_MS) ex = EXTRAPOLATE_MAX_MS;
      }
      let vx = 0;
      let vy = 0;
      let vz = 0;
      if (n >= 2 && ex > 0) {
        const iPrev = base + ((h - 2) & mask);
        const span = tNew - (times[iPrev] ?? 0);
        if (span > 0) {
          const oP = iPrev * RESULT_STRIDE;
          vx = ((vals[oN] ?? 0) - (vals[oP] ?? 0)) / span;
          vy = ((vals[oN + 1] ?? 0) - (vals[oP + 1] ?? 0)) / span;
          vz = ((vals[oN + 2] ?? 0) - (vals[oP + 2] ?? 0)) / span;
        }
      }
      out[ro] = (vals[oN] ?? 0) + vx * ex;
      out[ro + 1] = (vals[oN + 1] ?? 0) + vy * ex;
      out[ro + 2] = (vals[oN + 2] ?? 0) + vz * ex;
      out[ro + 3] = vals[oN + 3] ?? 0;
      out[ro + 4] = vals[oN + 4] ?? 0;
      out[ro + 5] = vals[oN + 5] ?? 0;
      out[ro + 6] = vals[oN + 6] ?? 0;
      out[ro + 7] = vals[oN + 7] ?? 1;
      this.discrete[slot * 2] = this.discreteStore[iNew * 2] ?? 0;
      this.discrete[slot * 2 + 1] = this.discreteStore[iNew * 2 + 1] ?? 0;
      this.status[slot] = status;
      return status;
    }

    // find the bracket: largest k with t_k <= render (k counted from the oldest sample)
    let k = n - 2;
    while (k >= 0 && (times[base + ((h - n + k) & mask)] ?? 0) > render) k--;
    if (k < 0) {
      // before the oldest sample: hold it
      const i0 = base + ((h - n) & mask);
      const o0 = i0 * RESULT_STRIDE;
      for (let c = 0; c < RESULT_STRIDE; c++) out[ro + c] = vals[o0 + c] ?? 0;
      this.discrete[slot * 2] = this.discreteStore[i0 * 2] ?? 0;
      this.discrete[slot * 2 + 1] = this.discreteStore[i0 * 2 + 1] ?? 0;
      this.status[slot] = SAMPLE_BEFORE;
      return SAMPLE_BEFORE;
    }

    const i0 = base + ((h - n + k) & mask);
    const i1 = base + ((h - n + k + 1) & mask);
    const t0 = times[i0] ?? 0;
    const t1 = times[i1] ?? 0;
    const span = t1 - t0;
    const a = span > 0 ? (render - t0) / span : 0;
    const o0 = i0 * RESULT_STRIDE;
    const o1 = i1 * RESULT_STRIDE;

    if (!hermite) {
      out[ro] = (vals[o0] ?? 0) + ((vals[o1] ?? 0) - (vals[o0] ?? 0)) * a;
      out[ro + 1] = (vals[o0 + 1] ?? 0) + ((vals[o1 + 1] ?? 0) - (vals[o0 + 1] ?? 0)) * a;
      out[ro + 2] = (vals[o0 + 2] ?? 0) + ((vals[o1 + 2] ?? 0) - (vals[o0 + 2] ?? 0)) * a;
      // shortest-arc yaw
      const y0 = vals[o0 + 3] ?? 0;
      let dy = (vals[o1 + 3] ?? 0) - y0;
      dy -= TWO_PI * Math.round(dy / TWO_PI);
      out[ro + 3] = y0 + dy * a;
      out[ro + 4] = 0;
      out[ro + 5] = 0;
      out[ro + 6] = 0;
      out[ro + 7] = 1;
    } else {
      // cubic Hermite on position with finite-difference tangents (central where both neighbours exist)
      const hasPrev = k > 0;
      const hasNext = k + 2 <= n - 1;
      const iP = base + ((h - n + k - 1) & mask);
      const iN = base + ((h - n + k + 2) & mask);
      const oP = iP * RESULT_STRIDE;
      const oN = iN * RESULT_STRIDE;
      const spanPrev = hasPrev ? t1 - (times[iP] ?? 0) : span;
      const spanNext = hasNext ? (times[iN] ?? 0) - t0 : span;
      const a2 = a * a;
      const a3 = a2 * a;
      const h00 = 2 * a3 - 3 * a2 + 1;
      const h10 = a3 - 2 * a2 + a;
      const h01 = -2 * a3 + 3 * a2;
      const h11 = a3 - a2;
      for (let c = 0; c < 3; c++) {
        const p0 = vals[o0 + c] ?? 0;
        const p1 = vals[o1 + c] ?? 0;
        const m0 = hasPrev ? (p1 - (vals[oP + c] ?? 0)) / spanPrev : (p1 - p0) / span;
        const m1 = hasNext ? ((vals[oN + c] ?? 0) - p0) / spanNext : (p1 - p0) / span;
        out[ro + c] = h00 * p0 + h10 * span * m0 + h01 * p1 + h11 * span * m1;
      }
      out[ro + 3] = 0;
      // quaternion slerp (hemisphere-corrected; normalised lerp when the angle is tiny)
      const ax = vals[o0 + 4] ?? 0;
      const ay = vals[o0 + 5] ?? 0;
      const az = vals[o0 + 6] ?? 0;
      const aw = vals[o0 + 7] ?? 1;
      let bx = vals[o1 + 4] ?? 0;
      let by = vals[o1 + 5] ?? 0;
      let bz = vals[o1 + 6] ?? 0;
      let bw = vals[o1 + 7] ?? 1;
      let dot = ax * bx + ay * by + az * bz + aw * bw;
      if (dot < 0) {
        dot = -dot;
        bx = -bx;
        by = -by;
        bz = -bz;
        bw = -bw;
      }
      let s0: number;
      let s1: number;
      if (dot > 0.9995) {
        s0 = 1 - a;
        s1 = a;
      } else {
        const theta = Math.acos(dot);
        const sinTheta = Math.sin(theta);
        s0 = Math.sin((1 - a) * theta) / sinTheta;
        s1 = Math.sin(a * theta) / sinTheta;
      }
      let qx = s0 * ax + s1 * bx;
      let qy = s0 * ay + s1 * by;
      let qz = s0 * az + s1 * bz;
      let qw = s0 * aw + s1 * bw;
      const len = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
      if (len > 0) {
        const inv = 1 / len;
        qx *= inv;
        qy *= inv;
        qz *= inv;
        qw *= inv;
      } else {
        qx = 0;
        qy = 0;
        qz = 0;
        qw = 1;
      }
      out[ro + 4] = qx;
      out[ro + 5] = qy;
      out[ro + 6] = qz;
      out[ro + 7] = qw;
    }
    this.discrete[slot * 2] = this.discreteStore[i0 * 2] ?? 0;
    this.discrete[slot * 2 + 1] = this.discreteStore[i0 * 2 + 1] ?? 0;
    this.status[slot] = SAMPLE_OK;
    return SAMPLE_OK;
  }
}
