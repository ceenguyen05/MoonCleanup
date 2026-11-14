// Per-client SPIKE_FRAME and SPIKE_DUST encoders (M0-W2-T03). Section layouts mimic netcode.md sections 4.2/4.5 and
// WDS section 5.1 so the spike measures realistic bytes and encode CPU; they are not the production FRAME codec.
//
// SPIKE_FRAME body = 8-byte header (packages/protocol writeSpikeFrameHeader) + byte-aligned sections:
//   Self (20 B)      own pos 3 x 24 b (0.49 mm, +-4,096 m) | vel 3 x 16 b (1/256 m/s) | yaw 10 b | moveState 5 b |
//                    hops 3 b | dustGrams 16 b | pad
//   SlotChanges      count u8, then per change (6 B): slot u8 | entityId u32 | kind 3 b | pad 5 b
//   Entities         count u8, then per record (byte-aligned): slot u8 | recType 2 b (0 FULL, 1 DELTA, 2 REMOVE) |
//                    FULL avatar  pos 3 x 20 b (6.25 mm) yaw 10 pitch 6 anim 6 tool 4 flags 6            (13 B)
//                    DELTA avatar class 3 x 2 b + per-axis delta (0 / 8 / 13 / 20 b) yaw 10 anim 6 flags 6 (~8 B)
//                    FULL vehicle pos 60 b orientation 32 b steer 6 speed 8 driverSlot 8 flags 8         (17 B)
//                    DELTA vehicle classes + deltas, orientation 32 b steer 6 speed 8                       (~11 B)
//                    FULL robot   pos 60 b heading 8 state 4 cargo 3                                         (11 B)
//                    DELTA robot  classes + deltas, heading 8                                                (~6 B)
//                    Unchanged entities are not listed. Robots ride every 2nd frame. Slot s is keyed (FULL) when
//                    (frameIndex + s) mod (5 x snapshotHz) == 0. Records that would pass the 1,000 B cap spill to
//                    the next frame (baseline untouched).
//   DustStrokes      count u8, per cleaning seat: chain header (kind 1 b = 1, 18 B) every 3 s, else continuation
//                    (kind 1 b = 0, actorSlot 5 b, dx 13 b, dy 13 b = 4 B)
//   Events           count u8, ~10 events/s x 10 B (rails, machines, stamps; netcode.md section 14: 100 B/s)
//
// Baselines are the last values SENT to that client. The transport is reliable and ordered (WebSocket over TCP), so
// the client always holds the baseline; a skipped frame (backpressure) must mark the client's slots unknown.
//
// SPIKE_DUST (every 4th tick, per client): header + L0 plots (50 changed plots/s moon-wide = 200 B/s) + robot
// intents (1/s x 17 B) + dust checks (8 chunks x 6 B every 5 s) + amortized ledger streaming (300 B/s). Counts use
// fractional accumulators so bytes/s stay constant across tick rates.

import {
  BitWriter,
  SPIKE_BUTTON_TOOL_PRIMARY,
  SPIKE_DUST_CHECK_BYTES,
  SPIKE_DUST_HEADER_BYTES,
  SPIKE_DUST_INTENT_BYTES,
  SPIKE_DUST_MAX_BODY_BYTES,
  SPIKE_DUST_PLOT_BYTES,
  SPIKE_FRAME_FLAG_ENTITIES,
  SPIKE_FRAME_FLAG_EVENTS,
  SPIKE_FRAME_FLAG_KEYFRAME,
  SPIKE_FRAME_FLAG_SLOT_CHANGES,
  SPIKE_FRAME_FLAG_STROKES,
  SPIKE_FRAME_HEADER_BYTES,
  SPIKE_FRAME_MAX_BODY_BYTES,
  createSpikeDustHeader,
  createSpikeFrameHeader,
  writeSpikeDustHeader,
  writeSpikeFrameHeader,
} from "@moon-cleanup/protocol";
import type { SyntheticWorld } from "./synthetic-world";

/** Quantization steps (netcode.md section 2). */
export const POS_OTHER_STEP_M = 0.00625;
export const POS_OWN_STEP_M = 4096 / 2 ** 23;
const POS_OTHER_MAX = 2 ** 19 - 1;
const POS_OWN_MAX = 2 ** 23 - 1;

const REC_FULL = 0;
const REC_DELTA = 1;
const REC_REMOVE = 2;

/** Rates of the synthetic payload lines (netcode.md section 14, WDS section 5.3). */
const EVENTS_PER_S = 10;
const DUST_PLOTS_PER_S = 50;
const DUST_INTENTS_PER_S = 1;
const DUST_CHECK_INTERVAL_S = 5;
const DUST_CHECK_CHUNKS = 8;
const LEDGER_BYTES_PER_S = 300;
const STROKE_CHAIN_PERIOD_S = 3;
const PLOT_COUNT = 163_842;

const yaw10 = (rad: number): number => {
  const turns = rad / (Math.PI * 2);
  return Math.floor((turns - Math.floor(turns)) * 1024) & 1023;
};

/** Per-seat facts the encoder needs from the engine. */
export interface SeatView {
  readonly activeSeat: Uint8Array;
  readonly buttons: Int32Array;
  readonly grams: Uint16Array;
  readonly lastConsumedSeq: Int32Array;
  readonly bufferDepth: Uint8Array;
}

export class FrameEncoder {
  readonly slotCount: number;
  private readonly seats: number;
  private readonly vehicles: number;
  private readonly robots: number;
  private readonly snapshotHz: number;
  private readonly tickHz: number;
  private readonly world: SyntheticWorld;
  /** Last sent quantized position per (seat, slot), 3 ints each. */
  private readonly baseline: Int32Array;
  /** Last sent yaw10 / heading8 per (seat, slot). */
  private readonly baseYaw: Int16Array;
  /** 1 = the client holds a baseline for the slot. */
  private readonly known: Uint8Array;
  /** 1 = the slot is assigned in the client's slot table. */
  private readonly assigned: Uint8Array;
  /** Shared output buffers (sendBytes copies the body, so one buffer serves every client). */
  private readonly frameBuf = new Uint8Array(SPIKE_FRAME_MAX_BODY_BYTES);
  private readonly dustBuf = new Uint8Array(SPIKE_DUST_MAX_BODY_BYTES);
  /** Cached exact-length views over the shared buffers (no subarray allocation per send after warm-up). */
  private readonly frameViews: (Uint8Array | undefined)[];
  private readonly dustViews: (Uint8Array | undefined)[];
  private readonly writer = new BitWriter(this.frameBuf);
  private readonly dustWriter = new BitWriter(this.dustBuf);
  private readonly header = createSpikeFrameHeader();
  /** Scratch for quantized triples (keeps doubles out of call boundaries). */
  private readonly q = new Int32Array(3);
  private readonly dustHeader = createSpikeDustHeader();
  /** Synthetic opaque ledger bytes ("already deflated"). */
  private readonly ledgerBytes = new Uint8Array(SPIKE_DUST_MAX_BODY_BYTES);
  private eventAcc = 0;
  private eventsThisFrame = 0;
  private plotAcc = 0;
  private intentAcc = 0;
  private ledgerAcc = 0;
  private checkAcc = 0;
  /** Frames whose entity section spilled (cap reached). */
  spills = 0;

  constructor(world: SyntheticWorld, seats: number, vehicles: number, tickHz: number, snapshotHz: number) {
    this.world = world;
    this.seats = seats;
    this.vehicles = vehicles;
    this.robots = world.robotCount;
    this.tickHz = tickHz;
    this.snapshotHz = snapshotHz;
    this.slotCount = seats + vehicles + world.robotCount;
    const pairs = seats * this.slotCount;
    this.baseline = new Int32Array(pairs * 3);
    this.baseYaw = new Int16Array(pairs);
    this.known = new Uint8Array(pairs);
    this.assigned = new Uint8Array(pairs);
    this.frameViews = new Array<Uint8Array | undefined>(SPIKE_FRAME_MAX_BODY_BYTES + 1);
    this.dustViews = new Array<Uint8Array | undefined>(SPIKE_DUST_MAX_BODY_BYTES + 1);
    let x = 0x9e3779b9;
    for (let i = 0; i < this.ledgerBytes.length; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      this.ledgerBytes[i] = x & 0xff;
    }
  }

  /** Forget everything a seat's client held (join, leave, skipped frame). */
  resetSeat(seat: number): void {
    const from = seat * this.slotCount;
    this.known.fill(0, from, from + this.slotCount);
    this.assigned.fill(0, from, from + this.slotCount);
  }

  /** Advance the per-frame rate accumulators once per frame interval (shared by all clients of the frame). */
  beginFrame(): void {
    this.eventAcc += EVENTS_PER_S / this.snapshotHz;
    this.eventsThisFrame = Math.floor(this.eventAcc);
    this.eventAcc -= this.eventsThisFrame;
  }

  /** Encodes one client's frame. Returns the exact-length body view (valid until the next encode). */
  encodeFrame(seat: number, tick: number, frameIndex: number, seatView: SeatView): Uint8Array {
    const w = this.writer;
    const world = this.world;
    w.reset();
    w.bitPos = SPIKE_FRAME_HEADER_BYTES * 8;
    let flags = 0;

    // Self (20 B).
    const q = this.q;
    q[0] = Math.max(-POS_OWN_MAX, Math.min(POS_OWN_MAX, Math.round((world.px[seat] ?? 0) / POS_OWN_STEP_M)));
    q[1] = Math.max(-POS_OWN_MAX, Math.min(POS_OWN_MAX, Math.round((world.py[seat] ?? 0) / POS_OWN_STEP_M)));
    q[2] = Math.max(-POS_OWN_MAX, Math.min(POS_OWN_MAX, Math.round((world.pz[seat] ?? 0) / POS_OWN_STEP_M)));
    w.writeSigned(q[0] ?? 0, 24);
    w.writeSigned(q[1] ?? 0, 24);
    w.writeSigned(q[2] ?? 0, 24);
    q[0] = Math.max(-32767, Math.min(32767, Math.round((world.vx[seat] ?? 0) * 256)));
    q[1] = Math.max(-32767, Math.min(32767, Math.round((world.vy[seat] ?? 0) * 256)));
    q[2] = Math.max(-32767, Math.min(32767, Math.round((world.vz[seat] ?? 0) * 256)));
    w.writeSigned(q[0] ?? 0, 16);
    w.writeSigned(q[1] ?? 0, 16);
    w.writeSigned(q[2] ?? 0, 16);
    w.writeBits(yaw10(world.yaw[seat] ?? 0), 10);
    w.writeBits(1, 5);
    w.writeBits(3, 3);
    w.writeBits(seatView.grams[seat] ?? 0, 16);
    w.align();

    const base = seat * this.slotCount;
    const flagsRow = world.interest[seat] as Uint8Array;
    const keyPeriod = 5 * this.snapshotHz;
    const robotFrame = (frameIndex & 1) === 0;

    // SlotChanges: assign newly visible slots.
    const slotCountAt = w.bitPos >>> 3;
    w.writeBits(0, 8);
    let changes = 0;
    for (let s = 0; s < this.slotCount; s++) {
      const want = this.wants(seat, s, flagsRow, seatView.activeSeat);
      if (want && this.assigned[base + s] === 0) {
        const mark = w.bitPos;
        w.writeBits(s, 8);
        w.writeBits(this.entityId(s), 16);
        w.writeBits(0, 16);
        w.writeBits(this.kindOf(s), 3);
        w.align();
        if (w.overflow) {
          w.overflow = false;
          w.bitPos = mark;
          break;
        }
        this.assigned[base + s] = 1;
        this.known[base + s] = 0;
        changes++;
      }
    }
    this.frameBuf[slotCountAt] = changes;
    if (changes > 0) flags |= SPIKE_FRAME_FLAG_SLOT_CHANGES;

    // Entities.
    const entityCountAt = w.bitPos >>> 3;
    w.writeBits(0, 8);
    let records = 0;
    let keyed = false;
    for (let s = 0; s < this.slotCount && records < 255; s++) {
      if (this.assigned[base + s] === 0) continue;
      const pair = base + s;
      const mark = w.bitPos;
      if (!this.wants(seat, s, flagsRow, seatView.activeSeat)) {
        w.writeBits(s, 8);
        w.writeBits(REC_REMOVE, 2);
        w.align();
        if (w.overflow) {
          w.overflow = false;
          w.bitPos = mark;
          this.spills++;
          break;
        }
        this.assigned[pair] = 0;
        this.known[pair] = 0;
        records++;
        continue;
      }
      const isRobot = s >= this.seats + this.vehicles;
      if (isRobot && !robotFrame && this.known[pair] === 1) continue;
      const full = this.known[pair] === 0 || (frameIndex + s) % keyPeriod === 0;
      const written = full ? this.writeFull(s, pair) : this.writeDelta(s, pair);
      if (w.overflow) {
        w.overflow = false;
        w.bitPos = mark;
        this.spills++;
        break;
      }
      if (written) {
        records++;
        if (full) keyed = true;
      }
    }
    this.frameBuf[entityCountAt] = records;
    if (records > 0) flags |= SPIKE_FRAME_FLAG_ENTITIES;
    if (keyed) flags |= SPIKE_FRAME_FLAG_KEYFRAME;

    // DustStrokes: one record per cleaning seat in interest (own echo included).
    const strokeCountAt = w.bitPos >>> 3;
    w.writeBits(0, 8);
    let strokes = 0;
    const chainPeriod = STROKE_CHAIN_PERIOD_S * this.snapshotHz;
    for (let a = 0; a < this.seats; a++) {
      if (seatView.activeSeat[a] !== 1 || ((seatView.buttons[a] ?? 0) & SPIKE_BUTTON_TOOL_PRIMARY) === 0) continue;
      if (a !== seat && flagsRow[a] !== 1) continue;
      const mark = w.bitPos;
      if ((frameIndex + a) % chainPeriod === 0) {
        w.writeBits(1, 1);
        w.writeBits(a, 5);
        w.writeBits((tick * 7 + a) % PLOT_COUNT, 18);
        w.writeBits(tick & 0xffff, 16);
        w.writeBits((tick * 3) & 0xffff, 16);
        w.writeBits((tick * 5) & 0xffff, 16);
        w.writeBits((tick * 11) & 0xffff, 16);
        w.writeBits(40, 8);
        w.writeBits(900, 16);
        w.writeBits(1, 4);
        w.writeBits(frameIndex & 0xff, 8);
        w.writeBits(seatView.lastConsumedSeq[a] ?? 0, 16);
      } else {
        w.writeBits(0, 1);
        w.writeBits(a, 5);
        w.writeSigned(((tick * 13 + a) % 2000) - 1000, 13);
        w.writeSigned(((tick * 17 + a) % 2000) - 1000, 13);
      }
      w.align();
      if (w.overflow) {
        w.overflow = false;
        w.bitPos = mark;
        break;
      }
      strokes++;
    }
    this.frameBuf[strokeCountAt] = strokes;
    if (strokes > 0) flags |= SPIKE_FRAME_FLAG_STROKES;

    // Events.
    const eventCountAt = w.bitPos >>> 3;
    w.writeBits(0, 8);
    let events = 0;
    for (let e = 0; e < this.eventsThisFrame; e++) {
      const mark = w.bitPos;
      w.writeBits(e & 3, 4);
      w.writeBits((tick + e) & 0xffff, 16);
      w.writeBits(frameIndex & 0xff, 8);
      w.writeBits((tick * 31 + e) & 0xffff, 16);
      w.writeBits(e & 0xffff, 16);
      w.writeBits(e & 7, 3);
      w.writeBits(0, 17);
      w.align();
      if (w.overflow) {
        w.overflow = false;
        w.bitPos = mark;
        break;
      }
      events++;
    }
    this.frameBuf[eventCountAt] = events;
    if (events > 0) flags |= SPIKE_FRAME_FLAG_EVENTS;

    this.header.serverTick = tick;
    this.header.ackInputSeq = seatView.lastConsumedSeq[seat] ?? 0;
    this.header.inputBufferDepth = seatView.bufferDepth[seat] ?? 0;
    this.header.flags = flags;
    writeSpikeFrameHeader(this.header, this.frameBuf, 0);
    return this.viewOf(this.frameBuf, this.frameViews, w.byteLength);
  }

  /** Advances the dust accumulators by one dust interval (every 4th tick). */
  beginDust(): void {
    const intervalS = 4 / this.tickHz;
    this.plotAcc += DUST_PLOTS_PER_S * intervalS;
    this.intentAcc += DUST_INTENTS_PER_S * intervalS;
    this.ledgerAcc += LEDGER_BYTES_PER_S * intervalS;
    this.checkAcc += intervalS;
    this.dustHeader.plotCount = Math.floor(this.plotAcc);
    this.plotAcc -= this.dustHeader.plotCount;
    this.dustHeader.intentCount = Math.floor(this.intentAcc);
    this.intentAcc -= this.dustHeader.intentCount;
    this.dustHeader.ledgerBytes = Math.floor(this.ledgerAcc);
    this.ledgerAcc -= this.dustHeader.ledgerBytes;
    if (this.checkAcc >= DUST_CHECK_INTERVAL_S) {
      this.checkAcc -= DUST_CHECK_INTERVAL_S;
      this.dustHeader.checkCount = DUST_CHECK_CHUNKS;
    } else {
      this.dustHeader.checkCount = 0;
    }
  }

  /** Encodes one client's SPIKE_DUST body (per client: intents, checks and ledgers are interest-filtered). */
  encodeDust(seat: number, tick: number): Uint8Array {
    const h = this.dustHeader;
    h.serverTick = tick;
    const w = this.dustWriter;
    w.reset();
    writeSpikeDustHeader(h, this.dustBuf, 0);
    w.bitPos = SPIKE_DUST_HEADER_BYTES * 8;
    for (let p = 0; p < h.plotCount; p++) {
      w.writeBits((tick * 131 + p * 977) % PLOT_COUNT, 18);
      w.writeBits(p & 3, 2);
      w.writeBits((tick + p) & 0xff, 8);
      w.writeBits(0, 4);
    }
    for (let i = 0; i < h.intentCount; i++) {
      w.writeBits((tick + seat) % PLOT_COUNT, 18);
      for (let k = 0; k < SPIKE_DUST_INTENT_BYTES * 8 - 18; k += 16) {
        w.writeBits((tick * 29 + k) & 0xffff, Math.min(16, SPIKE_DUST_INTENT_BYTES * 8 - 18 - k));
      }
    }
    for (let c = 0; c < h.checkCount; c++) {
      w.writeBits((c * 80 + seat) % 641, 10);
      w.writeBits((tick * 40503 + c) & 0xffff, 16);
      w.writeBits((tick ^ c) & 0xffff, 16);
      w.writeBits(0, 6);
    }
    w.align();
    const at = w.bitPos >>> 3;
    const ledger = this.ledgerBytes;
    const out = this.dustBuf;
    for (let i = 0; i < h.ledgerBytes; i++) out[at + i] = ledger[(seat + i) % ledger.length] ?? 0;
    const length =
      SPIKE_DUST_HEADER_BYTES +
      h.plotCount * SPIKE_DUST_PLOT_BYTES +
      h.intentCount * SPIKE_DUST_INTENT_BYTES +
      h.checkCount * SPIKE_DUST_CHECK_BYTES +
      h.ledgerBytes;
    return this.viewOf(this.dustBuf, this.dustViews, length);
  }

  private viewOf(buffer: Uint8Array, cache: (Uint8Array | undefined)[], length: number): Uint8Array {
    let view = cache[length];
    if (view === undefined) {
      view = buffer.subarray(0, length);
      cache[length] = view;
    }
    return view;
  }

  /** Should client `seat` see slot `s` this frame? */
  private wants(seat: number, s: number, flagsRow: Uint8Array, activeSeat: Uint8Array): boolean {
    if (s < this.seats) return s !== seat && activeSeat[s] === 1 && flagsRow[s] === 1;
    if (s < this.seats + this.vehicles) return flagsRow[s] === 1;
    const r = s - this.seats - this.vehicles;
    return r < this.robots && flagsRow[this.world.bodyCount + r] === 1;
  }

  private kindOf(s: number): number {
    if (s < this.seats) return 0;
    return s < this.seats + this.vehicles ? 1 : 2;
  }

  private entityId(s: number): number {
    return 1000 + s;
  }

  /** Quantizes slot `s`'s position (6.25 mm) into `this.q`. Doubles stay local: no boxed return values. */
  private quantize(s: number): void {
    const world = this.world;
    const body = s < this.seats + this.vehicles;
    const r = s - this.seats - this.vehicles;
    const x = body ? (world.px[s] ?? 0) : (world.rx[r] ?? 0);
    const y = body ? (world.py[s] ?? 0) : (world.ry[r] ?? 0);
    const z = body ? (world.pz[s] ?? 0) : (world.rz[r] ?? 0);
    const q = this.q;
    q[0] = Math.max(-POS_OTHER_MAX, Math.min(POS_OTHER_MAX, Math.round(x / POS_OTHER_STEP_M)));
    q[1] = Math.max(-POS_OTHER_MAX, Math.min(POS_OTHER_MAX, Math.round(y / POS_OTHER_STEP_M)));
    q[2] = Math.max(-POS_OTHER_MAX, Math.min(POS_OTHER_MAX, Math.round(z / POS_OTHER_STEP_M)));
  }

  private heading(s: number): number {
    if (s < this.seats + this.vehicles) return yaw10(this.world.yaw[s] ?? 0);
    return yaw10(this.world.rh[s - this.seats - this.vehicles] ?? 0) >>> 2;
  }

  private writeFull(s: number, pair: number): boolean {
    const w = this.writer;
    this.quantize(s);
    const qx = this.q[0] ?? 0;
    const qy = this.q[1] ?? 0;
    const qz = this.q[2] ?? 0;
    const yaw = this.heading(s);
    w.writeBits(s, 8);
    w.writeBits(REC_FULL, 2);
    w.writeSigned(qx, 20);
    w.writeSigned(qy, 20);
    w.writeSigned(qz, 20);
    if (s < this.seats) {
      w.writeBits(yaw, 10);
      w.writeBits(32, 6);
      w.writeBits(5, 6);
      w.writeBits(1, 4);
      w.writeBits(1, 6);
    } else if (s < this.seats + this.vehicles) {
      w.writeBits(yaw << 6, 16);
      w.writeBits(yaw, 16);
      w.writeBits(31, 6);
      w.writeBits(120, 8);
      w.writeBits(255, 8);
      w.writeBits(0x11, 8);
    } else {
      w.writeBits(yaw, 8);
      w.writeBits(3, 4);
      w.writeBits(2, 3);
    }
    w.align();
    if (w.overflow) return false;
    const b = pair * 3;
    this.baseline[b] = qx;
    this.baseline[b + 1] = qy;
    this.baseline[b + 2] = qz;
    this.baseYaw[pair] = yaw;
    this.known[pair] = 1;
    return true;
  }

  /** Writes a DELTA, or nothing when the entity is unchanged. Returns true when a record was written. */
  private writeDelta(s: number, pair: number): boolean {
    const w = this.writer;
    const b = pair * 3;
    this.quantize(s);
    const qx = this.q[0] ?? 0;
    const qy = this.q[1] ?? 0;
    const qz = this.q[2] ?? 0;
    const yaw = this.heading(s);
    const dx = qx - (this.baseline[b] ?? 0);
    const dy = qy - (this.baseline[b + 1] ?? 0);
    const dz = qz - (this.baseline[b + 2] ?? 0);
    if (dx === 0 && dy === 0 && dz === 0 && yaw === this.baseYaw[pair]) return false;
    w.writeBits(s, 8);
    w.writeBits(REC_DELTA, 2);
    const cx = sizeClass(dx);
    const cy = sizeClass(dy);
    const cz = sizeClass(dz);
    w.writeBits(cx, 2);
    w.writeBits(cy, 2);
    w.writeBits(cz, 2);
    writeAxis(w, cx, dx, qx);
    writeAxis(w, cy, dy, qy);
    writeAxis(w, cz, dz, qz);
    if (s < this.seats) {
      w.writeBits(yaw, 10);
      w.writeBits(5, 6);
      w.writeBits(1, 6);
    } else if (s < this.seats + this.vehicles) {
      w.writeBits(yaw << 6, 16);
      w.writeBits(yaw, 16);
      w.writeBits(31, 6);
      w.writeBits(120, 8);
    } else {
      w.writeBits(yaw, 8);
    }
    w.align();
    if (w.overflow) return false;
    this.baseline[b] = qx;
    this.baseline[b + 1] = qy;
    this.baseline[b + 2] = qz;
    this.baseYaw[pair] = yaw;
    return true;
  }
}

/** Position-delta size class (netcode.md section 2): 0 unchanged, 1 = 8 b, 2 = 13 b, 3 = absolute 20 b. */
function sizeClass(d: number): number {
  if (d === 0) return 0;
  if (d >= -128 && d <= 127) return 1;
  if (d >= -4096 && d <= 4095) return 2;
  return 3;
}

function writeAxis(w: BitWriter, cls: number, delta: number, absolute: number): void {
  if (cls === 1) w.writeSigned(delta, 8);
  else if (cls === 2) w.writeSigned(delta, 13);
  else if (cls === 3) w.writeSigned(absolute, 20);
}
