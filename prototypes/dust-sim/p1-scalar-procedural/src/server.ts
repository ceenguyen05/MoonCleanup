// P1 server: the L0 scalar is the only authoritative dust state. A stroke removes depth x swept area from its anchor
// plot under a uniform-dust assumption (no ledger, no stroke log). All arithmetic is on integers below 2^53, so the same
// strokes give the same bytes on Node and in every browser. Steady-state calls allocate nothing.
import type { RobotPlotIntent, StrokeRecord } from "@moon-cleanup/shared";
import {
  ACK_BYTES,
  ACTOR_SLOTS,
  L0_DEFAULT,
  L0_DIRTY_BIT,
  L0_VALUE_MASK,
  MSG_ACK,
  MSG_PLOTS,
  MSG_ROBOT,
  MSG_SNAPSHOT_RLE,
  MSG_SNAPSHOT_SPARSE,
  PLOTS_HEADER_BYTES,
  PLOTS_MAX_RECORDS,
  PLOT_RECORD_BYTES,
  ROBOT_MESSAGE_BYTES,
  SNAPSHOT_HEADER_BYTES,
  STATE_EMPTY,
  STATE_GRIMY,
  STATE_OPENED,
  STATE_POLISHED,
  hashTable,
  packRecord,
  readU32,
  writeU32,
  xorMix,
} from "./l0";

/** submitStroke result codes: 0 accepted, otherwise 1 + index into STROKE_REJECT_REASONS of the shared contract. */
export const STROKE_OK = 0;
export const REJECT_TOOL_NOT_EQUIPPED = 1;
export const REJECT_OUT_OF_REACH = 3;
export const REJECT_SEGMENT_TOO_LONG = 6;
export const REJECT_EMPTY_PLOT = 7;
export const REJECT_RATE_EXCEEDED = 8;

/** Ledger units per dust level and the Highland level (WDS 4.1); a plot holds u0 = 16 x level units per unit area. */
const UNITS_PER_LEVEL = 16;
const DEFAULT_LEVEL = 5;
/** Dust level per DustClass code (Highland, Mare, Crater Floor, Empty), WDS 4.1. Prototype copy, not game data. */
const CLASS_LEVEL = [5, 8, 13, 0] as const;
/** Micrograms per capacity unit. 0.062 kg/m^2 per level for every class, so the value is class-independent. */
const UG_PER_UNIT = 620;
/** Plot frame edge (25.6 m) squared, in m^2: robot lanes span the frame, the plot owns only its share of it. */
const FRAME_AREA_M2 = 655.36;
const FRAME_EDGE_MM = 25_600;
const FRAME_HALF_MM = 12_800;
const MAX_SEGMENT_MM = 4000;
const MAX_ROBOTS = 1024;
const CHECKPOINT_MAGIC = 0x4b433150; // "P1CK" little-endian
const CHECKPOINT_VERSION = 1;
const CHECKPOINT_HEADER_BYTES = 4 + 1 + 4 + 4 + ACTOR_SLOTS * 8 + 4;

export interface P1ServerOptions {
  readonly plotCount: number;
  readonly radiusM: number;
  readonly simTickHz: number;
  /** Optional baked per-plot data (DustClass codes and areas in m^2). Without it every plot is a mean-area Highland. */
  readonly classes?: Uint8Array;
  readonly areasM2?: Float32Array;
}

/** Receives one encoded message. The buffer is reused: copy it if it must outlive the call. */
export type MessageSink = (bytes: Uint8Array, length: number) => void;
export type AckSink = (actorSlot: number, bytes: Uint8Array, length: number) => void;

export class P1Server {
  readonly plotCount: number;
  readonly simTickHz: number;
  tick = 0;
  /** Capacity units removed so far per plot (0 = untouched; capacity = Polished). */
  readonly removed: Uint32Array;
  /** Replicated L0 value per plot plus the server-only dirty bit. */
  readonly l0: Uint16Array;
  /** XOR hash of all non-default plots, kept incrementally. */
  readonly hash = new Uint32Array(1);
  /** Whole micrograms collected per actor slot (exact integers in doubles). */
  readonly actorMicrograms = new Float64Array(ACTOR_SLOTS);
  nonDefaultCount = 0;
  /** Bumps on every L0 change; snapshot cache and checkpoint dirtiness key. */
  version = 0;
  strokesAccepted = 0;
  robotChunks = 0;

  private readonly capacity: Uint32Array | null;
  private readonly level16: Uint8Array | null;
  private readonly robotShare: Float32Array | null;
  private readonly capacityDefault: number;
  private readonly shareDefault: number;
  private readonly dirty = new Int32Array(PLOTS_MAX_RECORDS);
  private dirtyCount = 0;
  private readonly out = new Uint8Array(PLOTS_HEADER_BYTES + PLOTS_MAX_RECORDS * PLOT_RECORD_BYTES);
  private readonly small = new Uint8Array(ROBOT_MESSAGE_BYTES);
  private readonly lastTick = new Float64Array(ACTOR_SLOTS).fill(-1);
  private readonly lastTool = new Uint8Array(ACTOR_SLOTS);
  private readonly ackSent = new Uint32Array(ACTOR_SLOTS);
  private readonly robotActive = new Uint8Array(MAX_ROBOTS);
  private readonly robotPlot = new Int32Array(MAX_ROBOTS);
  private readonly robotStart = new Float64Array(MAX_ROBOTS);
  private readonly robotLeftMm = new Int32Array(MAX_ROBOTS);
  private readonly robotSpeedMm = new Int32Array(MAX_ROBOTS);
  private readonly robotWidthCm = new Int32Array(MAX_ROBOTS);
  private readonly robotDepth = new Int32Array(MAX_ROBOTS);
  private robotHigh = 0;
  private snapshot = new Uint8Array(0);
  private snapshotLength = 0;
  private snapshotVersion = -1;
  private checkpointVersion = -1;

  constructor(o: P1ServerOptions) {
    this.plotCount = o.plotCount;
    this.simTickHz = o.simTickHz;
    this.removed = new Uint32Array(o.plotCount);
    this.l0 = new Uint16Array(o.plotCount).fill(L0_DEFAULT);
    // Capacity unit = 16 mm * cm * (1/16 level): area in mm*cm (1 m^2 = 1e5) times u0, divided by 16 to fit a u32.
    const meanAreaM2 = (4 * Math.PI * o.radiusM * o.radiusM) / o.plotCount;
    this.capacityDefault = Math.floor((meanAreaM2 * 1e5 * UNITS_PER_LEVEL * DEFAULT_LEVEL) / 16);
    this.shareDefault = Math.min(1, meanAreaM2 / FRAME_AREA_M2);
    if (o.classes && o.areasM2) {
      this.capacity = new Uint32Array(o.plotCount);
      this.level16 = new Uint8Array(o.plotCount);
      this.robotShare = new Float32Array(o.plotCount);
      for (let i = 0; i < o.plotCount; i++) {
        const level = CLASS_LEVEL[o.classes[i] ?? 0] ?? DEFAULT_LEVEL;
        const area = o.areasM2[i] ?? meanAreaM2;
        this.level16[i] = UNITS_PER_LEVEL * level;
        this.capacity[i] = Math.floor((area * 1e5 * UNITS_PER_LEVEL * level) / 16);
        this.robotShare[i] = Math.min(1, area / FRAME_AREA_M2);
        if (level === 0) this.setValue(i, (STATE_EMPTY << 8) | 0);
      }
      this.dirtyCount = 0;
      for (let i = 0; i < o.plotCount; i++) this.l0[i] = (this.l0[i] ?? 0) & L0_VALUE_MASK;
    } else {
      this.capacity = null;
      this.level16 = null;
      this.robotShare = null;
    }
  }

  /** Capacity units of a plot (its starting dust). */
  capacityOf(plot: number): number {
    return this.capacity === null ? this.capacityDefault : (this.capacity[plot] ?? 0);
  }

  /** Whole grams collected by an actor slot. */
  gramsOf(actorSlot: number): number {
    return Math.floor((this.actorMicrograms[actorSlot] ?? 0) / 1e6);
  }

  /**
   * Validates and applies one stroke. Returns STROKE_OK or a reject code. `sink` receives a `dust.plots` message only
   * if the pending delta list is full and has to be flushed early (bounded memory, never an allocation).
   */
  submitStroke(s: StrokeRecord, sink: MessageSink): number {
    const anchor = s.anchor as number;
    if (!(anchor >= 0 && anchor < this.plotCount) || anchor !== Math.floor(anchor)) return REJECT_OUT_OF_REACH;
    const width = s.widthCm;
    const actor = s.actorSlot;
    if (!(width >= 1 && width <= 1023) || !(s.depth16 >= 0 && s.depth16 <= 255)) return REJECT_TOOL_NOT_EQUIPPED;
    if (!(actor >= 0 && actor < ACTOR_SLOTS) || !(s.toolCode >= 0 && s.toolCode <= 63)) return REJECT_TOOL_NOT_EQUIPPED;
    const eu = s.endUMm;
    const ev = s.endVMm;
    // The anchor contains the end point, so the end lies inside the plot frame; the start is at most one segment away.
    if (!(eu >= -FRAME_HALF_MM && eu <= FRAME_HALF_MM && ev >= -FRAME_HALF_MM && ev <= FRAME_HALF_MM)) {
      return REJECT_OUT_OF_REACH;
    }
    const du = eu - s.startUMm;
    const dv = ev - s.startVMm;
    const len2 = du * du + dv * dv;
    if (!(len2 <= MAX_SEGMENT_MM * MAX_SEGMENT_MM)) return REJECT_SEGMENT_TOO_LONG;
    const tick = s.tick as number;
    if (this.lastTick[actor] === tick && this.lastTool[actor] === s.toolCode) return REJECT_RATE_EXCEEDED;
    const value = (this.l0[anchor] ?? 0) & L0_VALUE_MASK;
    const state = value >>> 8;
    if (state === STATE_EMPTY) return REJECT_EMPTY_PLOT;
    this.lastTick[actor] = tick;
    this.lastTool[actor] = s.toolCode;
    this.strokesAccepted++;
    if (state === STATE_POLISHED || s.depth16 === 0) return STROKE_OK;
    // Swept area in mm * cm: flat-ended segment = length x width; a zero-length stroke is a disc of diameter width.
    const lenMm = Math.round(Math.sqrt(len2));
    const area = lenMm > 0 ? lenMm * width : Math.floor((width * width * 10 * 201) / 256);
    const u0 = this.level16 === null ? UNITS_PER_LEVEL * DEFAULT_LEVEL : (this.level16[anchor] ?? 0);
    // One pass cannot remove more dust than the layer holds (depth clamps to the plot's level).
    const depth = s.depth16 < u0 ? s.depth16 : u0;
    let units = Math.floor((area * depth) / 16);
    if (units < 1) units = 1;
    this.remove(anchor, units, actor, sink);
    return STROKE_OK;
  }

  /** Removes `units` of capacity from a plot, credits the actor and updates state, fraction, hash and the delta list. */
  private remove(plot: number, units: number, actor: number, sink: MessageSink): void {
    const cap = this.capacityOf(plot);
    const old = this.removed[plot] ?? 0;
    const polishAt = cap - Math.floor(cap / 100);
    if (old >= polishAt) return;
    let next = old + units;
    let credited = units;
    let value: number;
    if (next >= polishAt) {
      // Inspector's Stamp: the residual (at most 1 %) is not paid as dust (WDS 4.7).
      credited = polishAt - old;
      next = cap;
      value = STATE_POLISHED << 8;
    } else {
      const left = cap - next;
      const frac = Math.floor((255 * left + cap - 1) / cap);
      const openAt = Math.ceil(cap / 1000);
      value = ((next >= openAt ? STATE_OPENED : STATE_GRIMY) << 8) | frac;
    }
    this.removed[plot] = next;
    this.actorMicrograms[actor] = (this.actorMicrograms[actor] ?? 0) + credited * UG_PER_UNIT;
    const current = this.l0[plot] ?? 0;
    if (value !== (current & L0_VALUE_MASK)) {
      if ((current & L0_DIRTY_BIT) === 0 && this.dirtyCount === PLOTS_MAX_RECORDS) this.flushPlots(sink);
      this.setValue(plot, value);
    }
  }

  private setValue(plot: number, value: number): void {
    const current = this.l0[plot] ?? 0;
    const old = current & L0_VALUE_MASK;
    if (old !== L0_DEFAULT) xorMix(this.hash, plot, old);
    else this.nonDefaultCount++;
    xorMix(this.hash, plot, value);
    if ((current & L0_DIRTY_BIT) === 0) {
      this.dirty[this.dirtyCount] = plot;
      this.dirtyCount++;
    }
    this.l0[plot] = value | L0_DIRTY_BIT;
    this.version++;
  }

  /** Registers a robot plot job (WDS 4.8) and writes its 21 B `robot.plot` message to `sink`. Returns the bytes. */
  submitRobotIntent(intent: RobotPlotIntent, sink: MessageSink): number {
    const id = intent.robotId;
    const plot = intent.plotId as number;
    if (!(id >= 0 && id < MAX_ROBOTS) || !(plot >= 0 && plot < this.plotCount)) return 0;
    let lanes = 0;
    for (let w = 0; w < 2; w++) {
      let m = (intent.laneMask[w] ?? 0) >>> 0;
      while (m !== 0) {
        m &= m - 1;
        lanes++;
      }
    }
    this.robotActive[id] = 1;
    this.robotPlot[id] = plot;
    this.robotStart[id] = intent.startTick as number;
    this.robotLeftMm[id] = lanes * FRAME_EDGE_MM;
    this.robotSpeedMm[id] = intent.speedCmPerS * 10;
    this.robotWidthCm[id] = intent.widthCm;
    this.robotDepth[id] = intent.depth16;
    if (id >= this.robotHigh) this.robotHigh = id + 1;
    const b = this.small;
    b[0] = MSG_ROBOT;
    b[1] = id & 0xff;
    b[2] = id >>> 8;
    writeU32(b, 3, (intent.startTick as number) >>> 0);
    b[7] = intent.depth16;
    writeU32(b, 8, (intent.laneMask[0] ?? 0) >>> 0);
    writeU32(b, 12, (intent.laneMask[1] ?? 0) >>> 0);
    // 38 bits: PlotId 18 | width 10 | speed 10.
    writeU32(b, 16, (plot | (intent.widthCm << 18) | ((intent.speedCmPerS & 0xf) << 28)) >>> 0);
    b[20] = intent.speedCmPerS >>> 4;
    sink(b, ROBOT_MESSAGE_BYTES);
    return ROBOT_MESSAGE_BYTES;
  }

  /** Advances one tick: robot jobs remove one 1-second chunk each time a whole second has passed since their start. */
  step(sink: MessageSink): void {
    this.tick++;
    const hz = this.simTickHz;
    const tick = this.tick;
    for (let id = 0; id < this.robotHigh; id++) {
      if (this.robotActive[id] !== 1) continue;
      const elapsed = tick - (this.robotStart[id] ?? 0);
      if (elapsed <= 0 || elapsed % hz !== 0) continue;
      const left = this.robotLeftMm[id] ?? 0;
      const speed = this.robotSpeedMm[id] ?? 0;
      const chunk = left < speed ? left : speed;
      const plot = this.robotPlot[id] ?? 0;
      const u0 = this.level16 === null ? UNITS_PER_LEVEL * DEFAULT_LEVEL : (this.level16[plot] ?? 0);
      const d = this.robotDepth[id] ?? 0;
      const depth = d < u0 ? d : u0;
      const share = this.robotShare === null ? this.shareDefault : (this.robotShare[plot] ?? 0);
      const units = Math.floor((chunk * (this.robotWidthCm[id] ?? 0) * depth * share) / 16);
      // Robots are credited to the shift: the last actor slot.
      if (units > 0) this.remove(plot, units, ACTOR_SLOTS - 1, sink);
      this.robotChunks++;
      this.robotLeftMm[id] = left - chunk;
      if (left - chunk <= 0) this.robotActive[id] = 0;
    }
  }

  /** Sends the pending `dust.plots` deltas (4 B per changed plot). */
  flushPlots(sink: MessageSink): void {
    const n = this.dirtyCount;
    if (n === 0) return;
    const b = this.out;
    b[0] = MSG_PLOTS;
    b[1] = n & 0xff;
    b[2] = n >>> 8;
    let at = PLOTS_HEADER_BYTES;
    for (let k = 0; k < n; k++) {
      const plot = this.dirty[k] ?? 0;
      const value = (this.l0[plot] ?? 0) & L0_VALUE_MASK;
      this.l0[plot] = value;
      const lo = plot | (value << 18);
      b[at] = lo & 0xff;
      b[at + 1] = (lo >>> 8) & 0xff;
      b[at + 2] = (lo >>> 16) & 0xff;
      b[at + 3] = lo >>> 24;
      at += PLOT_RECORD_BYTES;
    }
    this.dirtyCount = 0;
    sink(b, at);
  }

  /** Sends `dust.ack` (authoritative Dust Cell grams, u24) to every actor whose whole grams changed. */
  flushAcks(sink: AckSink): void {
    const b = this.small;
    for (let a = 0; a < ACTOR_SLOTS - 1; a++) {
      const grams = Math.floor((this.actorMicrograms[a] ?? 0) / 1e6);
      const g = grams > 0xffffff ? 0xffffff : grams;
      if (g === this.ackSent[a]) continue;
      this.ackSent[a] = g;
      b[0] = MSG_ACK;
      b[1] = g & 0xff;
      b[2] = (g >>> 8) & 0xff;
      b[3] = g >>> 16;
      sink(a, b, ACK_BYTES);
    }
  }

  /**
   * Join snapshot of the whole moon: the smaller of a sparse list (4 B per non-default plot) and run-length runs
   * (u16 value + LEB128 run). Encoded once per L0 version and cached. Returns a view of the cache.
   */
  encodeSnapshot(): Uint8Array {
    if (this.snapshotVersion === this.version) {
      writeU32(this.snapshot, 1, this.tick >>> 0);
      return this.snapshot.subarray(0, this.snapshotLength);
    }
    const l0 = this.l0;
    let runs = 0;
    let rleBytes = 0;
    let runValue = -1;
    let runLength = 0;
    for (let i = 0; i <= l0.length; i++) {
      const v = i < l0.length ? (l0[i] ?? 0) & L0_VALUE_MASK : -2;
      if (v === runValue) {
        runLength++;
        continue;
      }
      if (runLength > 0) {
        runs++;
        rleBytes += 2 + (runLength < 0x80 ? 1 : runLength < 0x4000 ? 2 : 3);
      }
      runValue = v;
      runLength = 1;
    }
    const sparseBytes = this.nonDefaultCount * PLOT_RECORD_BYTES;
    const sparse = sparseBytes <= rleBytes;
    const total = SNAPSHOT_HEADER_BYTES + (sparse ? sparseBytes : rleBytes);
    if (this.snapshot.length < total) this.snapshot = new Uint8Array(total + 1024);
    const b = this.snapshot;
    b[0] = sparse ? MSG_SNAPSHOT_SPARSE : MSG_SNAPSHOT_RLE;
    writeU32(b, 1, this.tick >>> 0);
    writeU32(b, 5, sparse ? this.nonDefaultCount : runs);
    let at = SNAPSHOT_HEADER_BYTES;
    if (sparse) {
      for (let i = 0; i < l0.length; i++) {
        const v = (l0[i] ?? 0) & L0_VALUE_MASK;
        if (v === L0_DEFAULT) continue;
        writeU32(b, at, packRecord(i, v));
        at += PLOT_RECORD_BYTES;
      }
    } else {
      runValue = -1;
      runLength = 0;
      for (let i = 0; i <= l0.length; i++) {
        const v = i < l0.length ? (l0[i] ?? 0) & L0_VALUE_MASK : -2;
        if (v === runValue) {
          runLength++;
          continue;
        }
        if (runLength > 0) {
          b[at++] = runValue & 0xff;
          b[at++] = runValue >>> 8;
          let r = runLength;
          while (r >= 0x80) {
            b[at++] = (r & 0x7f) | 0x80;
            r >>>= 7;
          }
          b[at++] = r;
        }
        runValue = v;
        runLength = 1;
      }
    }
    this.snapshotLength = at;
    this.snapshotVersion = this.version;
    return b.subarray(0, at);
  }

  /** True when the L0 state changed since the last checkpoint (checkpoint only when dirty). */
  get checkpointDirty(): boolean {
    return this.checkpointVersion !== this.version;
  }

  /**
   * Durable state: header (magic, version, tick, hash, per-actor micrograms) + the join snapshot + the exact removed
   * units of every plot that is touched but not Polished (8 B each). Returns a fresh buffer (not a hot path).
   */
  encodeCheckpoint(): Uint8Array {
    const snap = this.encodeSnapshot();
    let touched = 0;
    for (let i = 0; i < this.plotCount; i++) {
      const r = this.removed[i] ?? 0;
      if (r !== 0 && (this.l0[i] ?? 0) >>> 8 !== STATE_POLISHED) touched++;
    }
    const b = new Uint8Array(CHECKPOINT_HEADER_BYTES + snap.length + 4 + touched * 8);
    writeU32(b, 0, CHECKPOINT_MAGIC);
    b[4] = CHECKPOINT_VERSION;
    writeU32(b, 5, this.tick >>> 0);
    writeU32(b, 9, this.hash[0] ?? 0);
    b.set(new Uint8Array(this.actorMicrograms.buffer), 13);
    let at = 13 + ACTOR_SLOTS * 8;
    writeU32(b, at, snap.length);
    at += 4;
    b.set(snap, at);
    at += snap.length;
    writeU32(b, at, touched);
    at += 4;
    for (let i = 0; i < this.plotCount; i++) {
      const r = this.removed[i] ?? 0;
      if (r === 0 || (this.l0[i] ?? 0) >>> 8 === STATE_POLISHED) continue;
      writeU32(b, at, i);
      writeU32(b, at + 4, r);
      at += 8;
    }
    this.checkpointVersion = this.version;
    return b;
  }

  /** Wipes all room state (the forced restart of S6). */
  reset(): void {
    this.removed.fill(0);
    this.l0.fill(L0_DEFAULT);
    this.hash[0] = 0;
    this.nonDefaultCount = 0;
    this.dirtyCount = 0;
    this.tick = 0;
    this.version++;
    this.actorMicrograms.fill(0);
    this.ackSent.fill(0);
    this.lastTick.fill(-1);
    this.robotActive.fill(0);
    this.robotHigh = 0;
    this.strokesAccepted = 0;
    this.robotChunks = 0;
    if (this.capacity && this.level16) {
      for (let i = 0; i < this.plotCount; i++) {
        if (this.level16[i] === 0) {
          this.setValue(i, STATE_EMPTY << 8);
          this.l0[i] = STATE_EMPTY << 8;
        }
      }
      this.dirtyCount = 0;
    }
  }

  /** Restores a checkpoint. Returns false (state reset) when the bytes are not a valid checkpoint of this grid. */
  restore(b: Uint8Array): boolean {
    this.reset();
    if (b.length < CHECKPOINT_HEADER_BYTES || readU32(b, 0) !== CHECKPOINT_MAGIC || b[4] !== CHECKPOINT_VERSION) {
      return false;
    }
    const tick = readU32(b, 5);
    const storedHash = readU32(b, 9);
    let at = 13 + ACTOR_SLOTS * 8;
    const snapLength = readU32(b, at);
    at += 4;
    if (at + snapLength + 4 > b.length) return false;
    if (!decodeSnapshot(b.subarray(at, at + snapLength), this.l0)) return false;
    at += snapLength;
    const touched = readU32(b, at);
    at += 4;
    if (at + touched * 8 !== b.length) return false;
    for (let i = 0; i < this.plotCount; i++) {
      if ((this.l0[i] ?? 0) >>> 8 === STATE_POLISHED) this.removed[i] = this.capacityOf(i);
    }
    for (let k = 0; k < touched; k++) {
      const plot = readU32(b, at);
      if (plot >= this.plotCount) return false;
      this.removed[plot] = readU32(b, at + 4);
      at += 8;
    }
    this.nonDefaultCount = hashTable(this.l0, this.hash);
    if ((this.hash[0] ?? 0) !== storedHash) {
      this.reset();
      return false;
    }
    new Uint8Array(this.actorMicrograms.buffer).set(b.subarray(13, 13 + ACTOR_SLOTS * 8));
    for (let a = 0; a < ACTOR_SLOTS; a++) this.ackSent[a] = this.gramsOf(a) > 0xffffff ? 0xffffff : this.gramsOf(a);
    this.tick = tick;
    this.version++;
    this.checkpointVersion = this.version;
    return true;
  }
}

/**
 * Capacity units one accepted stroke removes from a plot whose starting level is `u0` (16 x dust level). The same rule
 * as P1Server.submitStroke; a client uses it to know how much of a plot's L0 drop its own ring already shows.
 */
export function strokeUnits(s: StrokeRecord, u0: number): number {
  const du = s.endUMm - s.startUMm;
  const dv = s.endVMm - s.startVMm;
  const lenMm = Math.round(Math.sqrt(du * du + dv * dv));
  const area = lenMm > 0 ? lenMm * s.widthCm : Math.floor((s.widthCm * s.widthCm * 10 * 201) / 256);
  const depth = s.depth16 < u0 ? s.depth16 : u0;
  const units = Math.floor((area * depth) / 16);
  return units < 1 ? 1 : units;
}

/** Decodes a join snapshot (either format) into an L0 table. Returns false on malformed input. */
export function decodeSnapshot(b: Uint8Array, l0: Uint16Array): boolean {
  if (b.length < SNAPSHOT_HEADER_BYTES) return false;
  const type = b[0];
  const count = readU32(b, 5);
  let at = SNAPSHOT_HEADER_BYTES;
  if (type === MSG_SNAPSHOT_SPARSE) {
    if (at + count * PLOT_RECORD_BYTES !== b.length) return false;
    l0.fill(L0_DEFAULT);
    for (let k = 0; k < count; k++) {
      const lo = (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16);
      const plot = lo & 0x3ffff;
      if (plot >= l0.length) return false;
      l0[plot] = ((lo >>> 18) | ((b[at + 3] ?? 0) << 6)) & L0_VALUE_MASK;
      at += PLOT_RECORD_BYTES;
    }
    return true;
  }
  if (type !== MSG_SNAPSHOT_RLE) return false;
  let plot = 0;
  for (let k = 0; k < count; k++) {
    if (at + 3 > b.length) return false;
    const value = ((b[at] ?? 0) | ((b[at + 1] ?? 0) << 8)) & L0_VALUE_MASK;
    at += 2;
    let run = 0;
    let shift = 0;
    for (;;) {
      const byte = b[at++] ?? 0;
      run |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
      if (shift > 21 || at >= b.length + 1) return false;
    }
    if (plot + run > l0.length) return false;
    l0.fill(value, plot, plot + run);
    plot += run;
  }
  return plot === l0.length && at === b.length;
}

export { STATE_GRIMY, STATE_OPENED, STATE_POLISHED, STATE_EMPTY };
