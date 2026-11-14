// SpikeEngine: the transport-free core of LoadTestRoom (M0-W2-T03). It owns seats, input validation and sequencing
// (netcode.md sections 4.1, 5.1, 11), the synthetic world (section 15 line items), the frame/dust schedule and the
// encoders. LoadTestRoom is a thin Colyseus adapter over it; the allocation benchmark drives it directly.
//
// Per tick (netcode.md section 3): drain inputs -> world step -> staggered interest -> frames on frame ticks (any
// tickHz/snapshotHz ratio, Bresenham-scheduled) -> SPIKE_DUST every 4th tick. No allocation after warm-up.

import {
  SPIKE_BUTTON_TOOL_PRIMARY,
  SPIKE_INPUT_MAX_COUNT,
  createSpikeInput,
  readSpikeInputBody,
  type SpikeInput,
} from "@moon-cleanup/protocol";
import { FrameEncoder, type SeatView } from "./frame-encoder";
import { SPIKE_VEHICLES, type SpikeRoomOptions } from "./options";
import { SyntheticWorld } from "./synthetic-world";

/** Pending inputs kept per seat. */
export const INPUT_RING = 8;
/** Backlog above which two inputs are consumed in one tick (netcode.md section 3 step 1). */
const DOUBLE_STEP_BACKLOG = 4;
/** Sequence acceptance window (mod 2^16). */
const SEQ_WINDOW = 1024;
/** Consecutive substitutions after which the substituted input becomes neutral (hidden tab, netcode.md section 16). */
const NEUTRAL_AFTER_SUBSTITUTIONS = 3;
/** Violations > 50 in 10 s close the client (4104). */
export const SPIKE_VIOLATION_LIMIT = 50;
export const SPIKE_VIOLATION_WINDOW_MS = 10_000;
/** Inbound bytes > 8 KB/s sustained for 5 s close the client (4104). */
export const INBOUND_BYTES_PER_S_LIMIT = 8192;
export const INBOUND_SUSTAIN_S = 5;
/** Dust deltas every 4th tick (card). */
export const DUST_EVERY_TICKS = 4;

export const InputVerdict = {
  Accepted: 0,
  RateLimited: 1,
  Malformed: 2,
  /** Every input in the message was late/duplicate (dropped, not a violation). */
  Late: 3,
  NoSeat: 4,
} as const;
export type InputVerdict = (typeof InputVerdict)[keyof typeof InputVerdict];

/** Where encoded bodies go (the room maps seats to clients). Bodies are only valid during the call. */
export interface SpikeSink {
  frame(seat: number, body: Uint8Array): void;
  dust(seat: number, body: Uint8Array): void;
}

/** Counters for tests and the room-stats line. */
export interface SpikeCounters {
  inputsAccepted: number;
  inputsLate: number;
  inputsSubstituted: number;
  inputsRingOverflow: number;
  rateLimited: number;
  malformed: number;
  frames: number;
  dust: number;
}

export class SpikeEngine {
  readonly tickHz: number;
  readonly snapshotHz: number;
  readonly seats: number;
  readonly world: SyntheticWorld;
  readonly encoder: FrameEncoder;
  readonly counters: SpikeCounters = {
    inputsAccepted: 0,
    inputsLate: 0,
    inputsSubstituted: 0,
    inputsRingOverflow: 0,
    rateLimited: 0,
    malformed: 0,
    frames: 0,
    dust: 0,
  };
  tick = 0;
  frameIndex = 0;
  /** Shared wallet (Schema `walletLumens` stand-in). */
  walletLumens = 0;

  private readonly dt: number;
  private frameAcc = 0;
  private lastStepFramed = false;
  private activeCount = 0;
  private readonly activeSeat: Uint8Array;
  // Input ring per seat: field arrays of seats x INPUT_RING.
  private readonly ringSeq: Int32Array;
  private readonly ringMoveX: Int8Array;
  private readonly ringMoveY: Int8Array;
  private readonly ringYaw: Int32Array;
  private readonly ringButtons: Int32Array;
  private readonly ringHead: Uint8Array;
  private readonly ringCount: Uint8Array;
  private readonly lastReceivedSeq: Int32Array;
  private readonly lastConsumedSeq: Int32Array;
  private readonly hasReceived: Uint8Array;
  private readonly consumedAny: Uint8Array;
  private readonly substitutions: Uint8Array;
  private readonly buttons: Int32Array;
  private readonly grams: Uint16Array;
  private readonly bufferDepth: Uint8Array;
  // Token bucket per seat (netcode.md section 11: refill 1.5 x tickHz/s, burst 2 x tickHz).
  private readonly tokens: Float64Array;
  private readonly tokensAt: Float64Array;
  private readonly refillPerMs: number;
  private readonly burst: number;
  // Violations and inbound bytes per seat.
  private readonly violationCount: Uint16Array;
  private readonly violationWindowAt: Float64Array;
  private readonly inboundBytes: Uint32Array;
  private readonly inboundSecondAt: Float64Array;
  private readonly inboundOverSeconds: Uint8Array;
  private readonly decoded: SpikeInput[];
  private readonly seatView: SeatView;

  constructor(options: SpikeRoomOptions, seats: number) {
    this.tickHz = options.tickHz;
    this.snapshotHz = options.snapshotHz;
    this.seats = seats;
    this.dt = 1 / options.tickHz;
    const vehicles = Math.max(0, Math.min(SPIKE_VEHICLES, options.bodies - seats));
    const bodies = Math.max(options.bodies, seats);
    this.world = new SyntheticWorld({ bodies, robots: options.robots, seats, vehicles });
    this.encoder = new FrameEncoder(this.world, seats, vehicles, options.tickHz, options.snapshotHz);
    this.activeSeat = new Uint8Array(seats);
    const ring = seats * INPUT_RING;
    this.ringSeq = new Int32Array(ring);
    this.ringMoveX = new Int8Array(ring);
    this.ringMoveY = new Int8Array(ring);
    this.ringYaw = new Int32Array(ring);
    this.ringButtons = new Int32Array(ring);
    this.ringHead = new Uint8Array(seats);
    this.ringCount = new Uint8Array(seats);
    this.lastReceivedSeq = new Int32Array(seats);
    this.lastConsumedSeq = new Int32Array(seats);
    this.hasReceived = new Uint8Array(seats);
    this.consumedAny = new Uint8Array(seats);
    this.substitutions = new Uint8Array(seats);
    this.buttons = new Int32Array(seats);
    this.grams = new Uint16Array(seats);
    this.bufferDepth = new Uint8Array(seats);
    this.tokens = new Float64Array(seats);
    this.tokensAt = new Float64Array(seats);
    this.refillPerMs = (1.5 * options.tickHz) / 1000;
    this.burst = 2 * options.tickHz;
    this.violationCount = new Uint16Array(seats);
    this.violationWindowAt = new Float64Array(seats);
    this.inboundBytes = new Uint32Array(seats);
    this.inboundSecondAt = new Float64Array(seats);
    this.inboundOverSeconds = new Uint8Array(seats);
    this.decoded = Array.from({ length: SPIKE_INPUT_MAX_COUNT }, () => createSpikeInput());
    this.seatView = {
      activeSeat: this.activeSeat,
      buttons: this.buttons,
      grams: this.grams,
      lastConsumedSeq: this.lastConsumedSeq,
      bufferDepth: this.bufferDepth,
    };
  }

  get activeSeats(): number {
    return this.activeCount;
  }

  isActive(seat: number): boolean {
    return this.activeSeat[seat] === 1;
  }

  /** Claims the lowest free seat. Returns -1 when full. */
  addSeat(nowMs: number): number {
    for (let seat = 0; seat < this.seats; seat++) {
      if (this.activeSeat[seat] === 1) continue;
      this.activeSeat[seat] = 1;
      this.activeCount++;
      this.ringHead[seat] = 0;
      this.ringCount[seat] = 0;
      this.hasReceived[seat] = 0;
      this.consumedAny[seat] = 0;
      this.lastReceivedSeq[seat] = 0;
      this.lastConsumedSeq[seat] = 0;
      this.substitutions[seat] = 0;
      this.buttons[seat] = 0;
      this.grams[seat] = 0;
      this.tokens[seat] = this.burst;
      this.tokensAt[seat] = nowMs;
      this.violationCount[seat] = 0;
      this.violationWindowAt[seat] = nowMs;
      this.inboundBytes[seat] = 0;
      this.inboundSecondAt[seat] = nowMs;
      this.inboundOverSeconds[seat] = 0;
      this.world.setControl(seat, 0, 0, 0);
      this.world.placeNearCentre(seat, seat / this.seats);
      this.encoder.resetSeat(seat);
      // Others see the newcomer on their next staggered recompute (<= 0.5 s); the newcomer's own row is fresh now.
      this.world.recomputeSeat(seat);
      return seat;
    }
    return -1;
  }

  removeSeat(seat: number): void {
    if (this.activeSeat[seat] !== 1) return;
    this.activeSeat[seat] = 0;
    this.activeCount--;
    this.encoder.resetSeat(seat);
  }

  /** Counts inbound bytes. Returns true when the seat exceeded 8 KB/s for 5 consecutive seconds (close 4104). */
  noteInbound(seat: number, bytes: number, nowMs: number): boolean {
    if (nowMs - (this.inboundSecondAt[seat] ?? 0) >= 1000) {
      const over = (this.inboundBytes[seat] ?? 0) > INBOUND_BYTES_PER_S_LIMIT;
      this.inboundOverSeconds[seat] = over ? (this.inboundOverSeconds[seat] ?? 0) + 1 : 0;
      this.inboundBytes[seat] = 0;
      this.inboundSecondAt[seat] = nowMs;
    }
    this.inboundBytes[seat] = (this.inboundBytes[seat] ?? 0) + bytes;
    return (this.inboundOverSeconds[seat] ?? 0) >= INBOUND_SUSTAIN_S;
  }

  /** Records a violation. Returns true when the seat passed the limit (close 4104). */
  violation(seat: number, nowMs: number): boolean {
    if (nowMs - (this.violationWindowAt[seat] ?? 0) >= SPIKE_VIOLATION_WINDOW_MS) {
      this.violationWindowAt[seat] = nowMs;
      this.violationCount[seat] = 0;
    }
    const count = (this.violationCount[seat] ?? 0) + 1;
    this.violationCount[seat] = count;
    return count > SPIKE_VIOLATION_LIMIT;
  }

  /** Validates and queues a SPIKE_INPUT body. Never throws. */
  receiveInput(seat: number, body: Uint8Array, nowMs: number): InputVerdict {
    if (seat < 0 || seat >= this.seats || this.activeSeat[seat] !== 1) return InputVerdict.NoSeat;
    const tokens = Math.min(
      this.burst,
      (this.tokens[seat] ?? 0) + (nowMs - (this.tokensAt[seat] ?? nowMs)) * this.refillPerMs,
    );
    this.tokensAt[seat] = nowMs;
    if (tokens < 1) {
      this.tokens[seat] = tokens;
      this.counters.rateLimited++;
      return InputVerdict.RateLimited;
    }
    this.tokens[seat] = tokens - 1;
    const count = readSpikeInputBody(body, this.decoded);
    if (count < 0) {
      this.counters.malformed++;
      return InputVerdict.Malformed;
    }
    let accepted = 0;
    for (let i = 0; i < count; i++) {
      const input = this.decoded[i] as SpikeInput;
      if (this.hasReceived[seat] === 1) {
        const diff = (input.seq - (this.lastReceivedSeq[seat] ?? 0)) & 0xffff;
        if (diff === 0 || diff > SEQ_WINDOW) {
          this.counters.inputsLate++;
          continue;
        }
      }
      this.hasReceived[seat] = 1;
      this.lastReceivedSeq[seat] = input.seq;
      this.push(seat, input);
      accepted++;
    }
    this.counters.inputsAccepted += accepted;
    return accepted > 0 ? InputVerdict.Accepted : InputVerdict.Late;
  }

  /** One fixed step. */
  step(sink: SpikeSink): void {
    this.tick = (this.tick + 1) >>> 0;
    const tick = this.tick;

    // 1 Drain inputs.
    for (let seat = 0; seat < this.seats; seat++) {
      if (this.activeSeat[seat] === 1) this.drain(seat);
    }

    // 3 Sim stand-in.
    this.world.step(this.dt, this.activeSeat);
    for (let seat = 0; seat < this.seats; seat++) {
      if (this.activeSeat[seat] !== 1 || ((this.buttons[seat] ?? 0) & SPIKE_BUTTON_TOOL_PRIMARY) === 0) continue;
      this.grams[seat] = ((this.grams[seat] ?? 0) + 3) & 0xffff;
      this.walletLumens += 0.5;
    }

    // 5 Interest, staggered.
    this.world.recomputeInterest(this.activeSeat, this.activeCount, this.tickHz);

    // 6 Frames.
    this.frameAcc += this.snapshotHz;
    this.lastStepFramed = this.frameAcc >= this.tickHz;
    if (this.lastStepFramed) {
      this.frameAcc -= this.tickHz;
      this.frameIndex++;
      this.encoder.beginFrame();
      for (let seat = 0; seat < this.seats; seat++) {
        if (this.activeSeat[seat] !== 1) continue;
        sink.frame(seat, this.encoder.encodeFrame(seat, tick, this.frameIndex, this.seatView));
        this.counters.frames++;
      }
    }

    // Dust deltas every 4th tick.
    if (tick % DUST_EVERY_TICKS === 0 && this.activeCount > 0) {
      this.encoder.beginDust();
      for (let seat = 0; seat < this.seats; seat++) {
        if (this.activeSeat[seat] !== 1) continue;
        sink.dust(seat, this.encoder.encodeDust(seat, tick));
        this.counters.dust++;
      }
    }
  }

  /** True when the last step produced frames (the room flushes the Schema patch on the same tick). */
  frameTickJustRan(): boolean {
    return this.lastStepFramed;
  }

  ackSeq(seat: number): number {
    return this.lastConsumedSeq[seat] ?? 0;
  }

  gramsOf(seat: number): number {
    return this.grams[seat] ?? 0;
  }

  pendingInputs(seat: number): number {
    return this.ringCount[seat] ?? 0;
  }

  private push(seat: number, input: SpikeInput): void {
    let count = this.ringCount[seat] ?? 0;
    let head = this.ringHead[seat] ?? 0;
    if (count === INPUT_RING) {
      // Drop the oldest: the newest input matters most for feel.
      head = (head + 1) % INPUT_RING;
      count--;
      this.counters.inputsRingOverflow++;
    }
    const at = seat * INPUT_RING + ((head + count) % INPUT_RING);
    this.ringSeq[at] = input.seq;
    this.ringMoveX[at] = input.moveX;
    this.ringMoveY[at] = input.moveY;
    this.ringYaw[at] = input.yaw;
    this.ringButtons[at] = input.buttons;
    this.ringHead[seat] = head;
    this.ringCount[seat] = count + 1;
  }

  /** Consumes one input (two when the backlog is deep); substitutes a missing one (netcode.md section 5.1). */
  private drain(seat: number): void {
    const steps = (this.ringCount[seat] ?? 0) > DOUBLE_STEP_BACKLOG ? 2 : 1;
    for (let k = 0; k < steps; k++) {
      let consumed = false;
      while ((this.ringCount[seat] ?? 0) > 0) {
        const head = this.ringHead[seat] ?? 0;
        const at = seat * INPUT_RING + head;
        this.ringHead[seat] = (head + 1) % INPUT_RING;
        this.ringCount[seat] = (this.ringCount[seat] ?? 1) - 1;
        const seq = this.ringSeq[at] ?? 0;
        const diff = (seq - (this.lastConsumedSeq[seat] ?? 0)) & 0xffff;
        if (this.hasConsumed(seat) && (diff === 0 || diff > SEQ_WINDOW)) {
          this.counters.inputsLate++;
          continue;
        }
        this.lastConsumedSeq[seat] = seq;
        this.consumedAny[seat] = 1;
        this.buttons[seat] = this.ringButtons[at] ?? 0;
        this.world.setControl(seat, this.ringMoveX[at] ?? 0, this.ringMoveY[at] ?? 0, this.ringYaw[at] ?? 0);
        this.substitutions[seat] = 0;
        consumed = true;
        break;
      }
      if (!consumed && this.hasConsumed(seat)) {
        // Missing input: substitute (keep the last control) and consume its sequence number.
        this.lastConsumedSeq[seat] = ((this.lastConsumedSeq[seat] ?? 0) + 1) & 0xffff;
        this.counters.inputsSubstituted++;
        const subs = (this.substitutions[seat] ?? 0) + 1;
        this.substitutions[seat] = Math.min(255, subs);
        if (subs === NEUTRAL_AFTER_SUBSTITUTIONS) {
          this.world.setControl(seat, 0, 0, this.world.inputYawU16[seat] ?? 0);
          this.buttons[seat] = 0;
        }
        break;
      }
    }
    this.bufferDepth[seat] = Math.min(255, this.ringCount[seat] ?? 0);
  }

  /** Sequencing (late-drop, substitution) starts once the seat's first input was consumed. */
  private hasConsumed(seat: number): boolean {
    return this.consumedAny[seat] === 1;
  }
}
