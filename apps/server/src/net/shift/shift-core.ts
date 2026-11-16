// ShiftCore: the transport-free heart of ShiftRoom (netcode.md section 3). It owns the authoritative MoonRoomSim, one
// input sequencer + slot table + rate buckets per seat, interest sets, and the per-client FRAME encoding. ShiftRoom is
// a thin Colyseus adapter over it; tests and the tick benchmark drive it directly.
//
// Per tick (`step`): (1) drain one input per seat by the section 5.1 rules and `applyInput`; (2) apply queued control
// intents in arrival order; (3) `sim.step(dt)`; (4) collect accepted strokes (with the author's position for dust
// interest); (5) recompute interest for a staggered subset of seats; (6) on frame ticks encode one FRAME per client
// with ONE reused FrameWriter and hand it to the sink (Colyseus copies on send, so the buffer is reused at once).
//
// Steady state allocates nothing in this file: typed arrays and pooled structs only. Sim events (rare) and the
// intent queue (control path) are the only allocating paths.

import {
  AVATAR_ACTION_STATES,
  AVATAR_FLAG_BIT,
  DEFAULT_SNAPSHOT_HZ,
  DUST_CHECK_INTERVAL_S,
  HIDDEN_FRAME_HZ,
  DUST_MESSAGE_SLICE_MAX_BYTES,
  INPUT_RATE_LIMIT_FACTORS,
  MAX_PLAYERS_PER_ROOM,
  SIM_EVENTS_BATCH_MAX,
  type ActorJoinInfo,
  type ContractId,
  type ControlIntent,
  type IntentResult,
  type RoomSimEvent,
  type ShiftType,
  type WireSimEvent,
} from "@moon-cleanup/shared";
import {
  DUST_CHECK_ID,
  DUST_LEDGER_ID,
  DUST_SNAPSHOT_ID,
  DustPlotDeltaList,
  FrameWriter,
  InputBatch,
  decodeDustRequest,
  DUST_REQUEST_ID,
  DUST_SNAPSHOT_MAX_LEDGERS,
  SlotTable,
  StrokeChainBuffer,
  createEntityState,
  createSelfState,
  decodeInput,
  INPUT_ID,
  inputPitchToRadians,
  pitchToCode,
  yawToCode,
} from "@moon-cleanup/protocol";
import type { GameData } from "@moon-cleanup/game-data";
import {
  MOVE_GROUNDED,
  MoonRoomSim,
  SIM_CHECKPOINT_META_VERSION,
  SIM_CHECKPOINT_PLAYERS_VERSION,
  atan2Det,
  headingBasis,
  type AvatarState,
  type SimRestoreResult,
  type SimWorld,
} from "@moon-cleanup/sim";
import type { WorldDustLedger } from "@moon-cleanup/world";
import { WS_BULK_SEND_CEILING_BYTES, WS_SEND_OVERHEAD_BYTES } from "../limits";
import { ConsumeKind, InputAccept, InputSequencer } from "./input-sequencer";
import { createShiftLedger } from "./shift-ledger";
import {
  DUST_STREAM_BYTES_PER_S,
  DUST_STREAM_HYSTERESIS_M,
  DustInterestScan,
  ShiftDust,
  type DustSnapshotBuild,
} from "./shift-dust";
import { TokenBucket } from "./token-bucket";

const ENTITY_KIND_AVATAR = 0;
const REC_DELTA = 1;
/** Strokes accepted between two frame ticks (<= 1 per actor per tick, F ticks per frame, plus headroom). */
const STROKES_PER_FRAME_MAX = MAX_PLAYERS_PER_ROOM * 8;
/** Entity interest outer limit and hysteresis (netcode.md section 7). */
export const ENTITY_INTEREST_MAX_M = 400;
export const ENTITY_INTEREST_HYSTERESIS_M = 20;
/** Height floor above ground and crater-rim margin of the horizon test (section 7). */
const INTEREST_HEIGHT_FLOOR_M = 1.5;
const INTEREST_MARGIN_M = 40;
/** Default dust residency radius until the client sends `dust_interest` (WDS section 5.2 range 60-220). */
export const DEFAULT_DUST_RADIUS_M = 220;
/** Dust interest margin beyond the declared radius (WDS section 5.2). */
const DUST_MARGIN_M = 20;
/** Streamed-ledger queue per seat (plots waiting for their DUST_LEDGER). */
const STREAM_QUEUE_MAX = 1024;
/** At most one DUST_SNAPSHOT per seat per this many seconds (a faster resync request waits; bounds egress). */
export const SNAPSHOT_MIN_INTERVAL_S = 2;
/**
 * Per-seat DUST_SNAPSHOT egress budget (security review F1): a repeated `visibility {hidden:false}` must not force a
 * full snapshot every SNAPSHOT_MIN_INTERVAL_S. Each snapshot built charges its wire bytes; a seat whose credit is not
 * positive waits (the request stays pending, nothing is dropped or closed). Sustained rate <= refill; typical 15-25 KB
 * snapshots (join, unhide, reconnect) stay well inside the burst.
 */
export const SNAPSHOT_EGRESS_BYTES_PER_S = 4096;
export const SNAPSHOT_EGRESS_BURST_BYTES = 98304;
/**
 * Lowest snapshot-egress credit (debt) a seat can carry (review N1): a 261 KB first snapshot would otherwise leave about
 * -163 KB and make the next unhide or in-hold reconnect resync wait ~40 s. At the floor the wait is at most
 * `32768 / SNAPSHOT_EGRESS_BYTES_PER_S` = 8 s, while sustained egress stays bounded at ~4 KB/s plus one capped burst.
 */
export const SNAPSHOT_EGRESS_DEBT_FLOOR_BYTES = -32768;
/** `dust.plots` deltas written per plots frame (4 B each; the rest carry to the next plots frame). */
export const PLOT_DELTAS_PER_FRAME = 64;

/** Why an INPUT message was refused (counted; the room turns some into violations). */
export const InputVerdict = {
  Ok: 0,
  Malformed: 1,
  RateLimited: 2,
  NoSeat: 3,
} as const;
export type InputVerdict = (typeof InputVerdict)[keyof typeof InputVerdict];

const ACTION = {
  none: AVATAR_ACTION_STATES.indexOf("none"),
  airborne: AVATAR_ACTION_STATES.indexOf("airborne"),
  sweep: AVATAR_ACTION_STATES.indexOf("sweep"),
  detailing: AVATAR_ACTION_STATES.indexOf("trait_detailing"),
} as const;

/** Where the core delivers per-seat output. */
export interface ShiftSink {
  /** One FRAME message body (without the 0x20 type byte, which travels as the Colyseus bytes type). */
  frame(seat: number, body: Uint8Array): void;
  /** Batched wire sim events (frame ticks, only when non-empty). The array is reused: copy to keep. */
  events?(events: readonly WireSimEvent[]): void;
  /**
   * One dust bytes message for a seat (DUST_SNAPSHOT slice, DUST_LEDGER, DUST_CHECK), body without the type byte.
   * Called on frame ticks right after the frames (ordering rule of ./shift-dust). The body may be a reused view.
   */
  bytes?(seat: number, typeId: number, body: Uint8Array): void;
  /**
   * Bytes queued on the seat's socket and not yet written out (0 when unknown). Paces the DUST_SNAPSHOT slices: they
   * go out only while this plus the slices already sent this tick stays under the core's bulk-send ceiling.
   */
  buffered?(seat: number): number;
}

export interface ShiftCoreOptions {
  readonly data: GameData;
  readonly world: SimWorld;
  readonly contractId: ContractId;
  readonly shiftType: ShiftType;
  readonly simTickHz: number;
  readonly snapshotHz?: number;
  readonly walletLm?: number;
  /** Restored Near Parcel mask (bit k = collected). Restore it whenever `walletLm` is restored (review B1). */
  readonly nearParcelsCollected?: number;
  readonly startTick?: number;
  /** Test seam: unit direction where avatars spawn (default: the sim's Outpost Boreal spawn). */
  readonly spawnDirection?: { readonly x: number; readonly y: number; readonly z: number };
  /** Test seam: the room's dust ledger (default: a fresh `createShiftLedger`, as the Solo host builds). */
  readonly ledger?: WorldDustLedger;
  /** Bulk-send ceiling in socket-buffered bytes for snapshot slices (default `WS_BULK_SEND_CEILING_BYTES`). */
  readonly bulkSendCeilingBytes?: number;
}

class Seat {
  active = false;
  /** Seated but disconnected (seat hold): no inputs, neutral avatar. */
  held = false;
  hidden = false;
  readonly seq = new InputSequencer();
  readonly table = new SlotTable();
  inputBucket: TokenBucket;
  dustRadiusM = DEFAULT_DUST_RADIUS_M;
  /** Entity interest per other slot (1 = streamed). */
  readonly interest = new Uint8Array(MAX_PLAYERS_PER_ROOM);
  /** Last tick a non-neutral input was consumed (AFK rule). */
  lastActiveTick = 0;
  /** Request a keyframe on the next frame (join, reconnect, unhide). */
  keyframe = true;
  /** Send a DUST_SNAPSHOT after the next frame (join, reconnect, resync). */
  dustSnapshot = true;
  /** Per plot: 0 = client has no ledger from us, 1 = sent, 2 = queued. Allocated on first use. */
  dustSent: Uint8Array | null = null;
  /** Skip state of the streamed-ledger interest pass (reset whenever `dustSent` changes outside the pass). */
  readonly dustScan = new DustInterestScan();
  readonly streamQueue = new Int32Array(STREAM_QUEUE_MAX);
  streamHead = 0;
  streamTail = 0;
  /** Streaming byte allowance (refilled per frame tick). */
  streamCredit = 0;
  /** Tick of the last snapshot sent (a resync request inside SNAPSHOT_MIN_INTERVAL_S waits; abuse bound). */
  lastSnapshotTick = -1e9;
  /** Snapshot egress credit in bytes (may go negative after a large snapshot; see SNAPSHOT_EGRESS_BYTES_PER_S). */
  snapshotCredit = SNAPSHOT_EGRESS_BURST_BYTES;
  /** Tick at which the next 5 s DUST_CHECK chunks summary is due (-1: arm on the first idle frame tick). */
  nextCheckTick = -1;
  /**
   * Slices of the snapshot still being paced out to this seat (null: none). The slices are standalone copies, so
   * holding them across ticks needs no buffer reuse care.
   */
  snapSlices: Uint8Array[] | null = null;
  snapNext = 0;
  /** Ledgers baked into the paced snapshot and their versions at build time (allocated on first paced snapshot). */
  snapPlots: Int32Array | null = null;
  snapVersions: Uint32Array | null = null;
  snapCount = 0;

  constructor(inputPerSecond: number, inputBurst: number, now: number) {
    this.inputBucket = new TokenBucket(inputPerSecond, inputBurst, now);
  }
}

export class ShiftCore {
  readonly sim: MoonRoomSim;
  /** The room's dust ledger. The sim reads and empties its Opened / Polished queues; the core empties the dirty list. */
  readonly ledger: WorldDustLedger;
  /** Ledger pool growths since construction (a growth on the tick path is a copy; should stay 0). */
  private readonly poolGrowthsAtStart: number;
  readonly simTickHz: number;
  readonly snapshotHz: number;
  readonly dt: number;
  /** Ticks per frame (F = SIM_TICK_HZ / SNAPSHOT_HZ). */
  readonly framesEvery: number;
  readonly counters = {
    inputsMalformed: 0,
    inputsRateLimited: 0,
    inputsLate: 0,
    inputsTooFarAhead: 0,
    framesSent: 0,
    dustSnapshotsSent: 0,
    dustSnapshotBytes: 0,
    /** Snapshots that did not fit one tick's headroom and finished on a later frame tick. */
    dustSnapshotsPaced: 0,
    /** Frame ticks on which a paced snapshot sent nothing because the socket buffer was full. */
    dustSnapshotPauses: 0,
    /** Snapshot ledgers re-queued as DUST_LEDGER because they changed while their snapshot was paced out. */
    dustSnapshotCatchUps: 0,
    /** Snapshot ledgers whose plot was Polished while the snapshot was paced out (no ledger left to re-send). */
    dustSnapshotStale: 0,
    dustLedgersStreamed: 0,
    dustLedgerBytes: 0,
    dustRequests: 0,
    dustRequestsInvalid: 0,
    plotDeltasSent: 0,
    plotDeltasDropped: 0,
    frameEncodeFailures: 0,
    strokesDropped: 0,
    intentsQueued: 0,
  };
  private readonly seats: Seat[] = [];
  private readonly writer = new FrameWriter();
  private readonly self = createSelfState();
  private readonly ent = createEntityState();
  private readonly basis = new Float64Array(9);
  private readonly batch = new InputBatch();
  /** Decode scratch: the Colyseus body has no type byte, the codec wants it, so copy into exact-length arrays. */
  private readonly in1 = new Uint8Array(1 + 1 + 10);
  private readonly in2 = new Uint8Array(1 + 1 + 20);
  /** Strokes accepted since the last frame tick, with author positions for dust interest. */
  private readonly strokes = new StrokeChainBuffer(STROKES_PER_FRAME_MAX, 1);
  private readonly strokePos = new Float64Array(STROKES_PER_FRAME_MAX * 3);
  /** Per-client filtered copy of `strokes`. */
  private readonly strokeScratch = new StrokeChainBuffer(STROKES_PER_FRAME_MAX, 1);
  private readonly intentQueue: { seat: number; intent: ControlIntent; reply?: (r: IntentResult) => void }[] = [];
  private readonly pendingEvents: WireSimEvent[] = [];
  private readonly eventBatch: WireSimEvent[] = [];
  private readonly framesHidden: number;
  private readonly keyframeEvery: number;
  private readonly visPerSide: number;
  private frameIndex = 0;
  private interestCursor = 0;
  /** Dust sync (snapshots, streamed ledgers, check answers). */
  readonly dust: ShiftDust;
  /** Last snapshot built (tests and the report). */
  lastSnapshot: DustSnapshotBuild | null = null;
  /** Moon-wide `dust.plots` backlog: changed plots in order, deduplicated by `deltaFlag`. */
  private deltaList = new Int32Array(512);
  private deltaN = 0;
  private readonly deltaFlag: Uint8Array;
  private readonly deltaOut = new DustPlotDeltaList();
  private readonly plotsEvery: number;
  /** Chunk DUST_REQUESTs waiting for the next frame tick: pairs (seat, chunkId). */
  private readonly pendingChecks: number[] = [];
  private readonly requestMsg = new Uint8Array(32);
  private readonly bulkCeiling: number;
  /** Ticks between two DUST_CHECK chunk summaries of a seat (DUST_CHECK_INTERVAL_S, WDS 5.1). */
  private readonly checkEveryTicks: number;

  constructor(options: ShiftCoreOptions, now: number = performance.now()) {
    // Never below one full slice, or a paced snapshot could not make progress.
    this.bulkCeiling = Math.max(
      options.bulkSendCeilingBytes ?? WS_BULK_SEND_CEILING_BYTES,
      DUST_MESSAGE_SLICE_MAX_BYTES + WS_SEND_OVERHEAD_BYTES,
    );
    this.simTickHz = options.simTickHz;
    this.checkEveryTicks = Math.round(DUST_CHECK_INTERVAL_S * options.simTickHz);
    this.snapshotHz = options.snapshotHz ?? DEFAULT_SNAPSHOT_HZ;
    this.ledger = options.ledger ?? createShiftLedger(options.data, options.world, this.simTickHz);
    this.poolGrowthsAtStart = this.ledger.poolGrowths;
    this.sim = new MoonRoomSim({
      data: options.data,
      world: options.world,
      ledger: this.ledger,
      contractId: options.contractId,
      shiftType: options.shiftType,
      tickHz: this.simTickHz,
      snapshotHz: this.snapshotHz,
      ...(options.walletLm === undefined ? {} : { walletLm: options.walletLm }),
      ...(options.nearParcelsCollected === undefined ? {} : { nearParcelsCollected: options.nearParcelsCollected }),
      ...(options.spawnDirection === undefined ? {} : { spawnDirection: options.spawnDirection }),
      ...(options.startTick === undefined ? {} : { startTick: options.startTick }),
    });
    this.dt = this.sim.config.dt;
    this.framesEvery = Math.max(1, Math.round(this.simTickHz / this.snapshotHz));
    this.framesHidden = Math.max(1, Math.round(this.snapshotHz / HIDDEN_FRAME_HZ));
    this.keyframeEvery = 5 * this.snapshotHz;
    const r = this.sim.config.moonRadiusM;
    this.visPerSide = Math.sqrt(2 * r * INTEREST_HEIGHT_FLOOR_M);
    const perSecond = INPUT_RATE_LIMIT_FACTORS.refill * this.simTickHz;
    const burst = INPUT_RATE_LIMIT_FACTORS.burst * this.simTickHz;
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) this.seats.push(new Seat(perSecond, burst, now));
    this.in1[0] = INPUT_ID;
    this.in2[0] = INPUT_ID;
    this.sim.onEvent((e) => this.onSimEvent(e));
    this.dust = new ShiftDust(this.ledger, r);
    this.deltaFlag = new Uint8Array(this.ledger.plotCount);
    // `dust.plots` every SNAPSHOT_HZ/2-th frame (2 Hz at defaults, WDS 5.1).
    this.plotsEvery = Math.max(1, Math.round(this.snapshotHz / 2));
  }

  /** Ledger pool growths on the tick path since construction (ops counter). */
  get ledgerPoolGrowths(): number {
    return this.ledger.poolGrowths - this.poolGrowthsAtStart;
  }

  // ---- shared save state (room header, review N1) -------------------------------------------------------------------

  /**
   * The sim META save section (wallet, Near Parcels, Standard Issue tools, Repeat Requisition copies, suit gear, board
   * levels, Roosts). Event time only (a checkpoint write): it allocates; never call it on the tick path.
   */
  captureSharedMeta(): { version: number; bytes: Uint8Array } {
    return { version: SIM_CHECKPOINT_META_VERSION, bytes: this.sim.captureCheckpoint().meta };
  }

  /**
   * Restores a META section stored by `captureSharedMeta` into the fresh room, before anyone is seated (an empty
   * PLAYERS section: avatars spawn fresh). The bytes are untrusted: the sim validates everything and a refused section
   * changes nothing. Throws when a seat is already taken (a mid-shift restore would swap gear under the players).
   */
  restoreSharedMeta(meta: { readonly version: number; readonly bytes: Uint8Array }): SimRestoreResult {
    if (this.activeSeats > 0) throw new Error("restoreSharedMeta: only before the first seat");
    return this.sim.restoreCheckpoint({
      metaVersion: meta.version,
      meta: meta.bytes,
      playersVersion: SIM_CHECKPOINT_PLAYERS_VERSION,
      players: Uint8Array.of(0, this.sim.config.tools.length),
    });
  }

  // ---- seats ------------------------------------------------------------------------------------------------------

  get activeSeats(): number {
    let n = 0;
    for (const s of this.seats) if (s.active) n++;
    return n;
  }

  isActive(seat: number): boolean {
    return this.seats[seat]?.active === true;
  }

  /** Seats a player in the lowest free slot. Returns the slot, or -1 when full. */
  addSeat(info: ActorJoinInfo, now: number = performance.now()): number {
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      const seat = this.seats[s]!;
      if (seat.active) continue;
      seat.active = true;
      seat.held = false;
      seat.hidden = false;
      seat.seq.reset();
      seat.table.reset();
      seat.inputBucket.reset(now);
      seat.dustRadiusM = DEFAULT_DUST_RADIUS_M;
      this.configureDustScan(seat);
      seat.interest.fill(0);
      seat.lastActiveTick = this.sim.tick;
      seat.keyframe = true;
      seat.lastSnapshotTick = -1e9;
      seat.snapshotCredit = SNAPSHOT_EGRESS_BURST_BYTES; // a new occupant starts with a full budget
      this.requestDustSnapshot(seat);
      this.sim.addActor(s, info);
      this.refreshInterest(s);
      return s;
    }
    return -1;
  }

  removeSeat(slot: number): void {
    const seat = this.seats[slot];
    if (seat === undefined || !seat.active) return;
    seat.active = false;
    seat.held = false;
    this.sim.removeActor(slot);
  }

  /** Seat hold (netcode.md section 9.2): the avatar stays, frozen on neutral input, until reconnect or release. */
  holdSeat(slot: number): void {
    const seat = this.seats[slot];
    if (seat?.active !== true) return;
    seat.held = true;
    seat.seq.reset();
  }

  /** Reconnected inside the hold: fresh sequence and a keyframe with a rebuilt slot table. */
  resumeSeat(slot: number, now: number = performance.now()): void {
    const seat = this.seats[slot];
    if (seat?.active !== true) return;
    seat.held = false;
    seat.seq.reset();
    seat.table.reset();
    seat.inputBucket.reset(now);
    // A reconnect is a new socket that needs its snapshot soon: cap any leftover debt (review N1), at most ~8 s of wait.
    if (seat.snapshotCredit < SNAPSHOT_EGRESS_DEBT_FLOOR_BYTES) seat.snapshotCredit = SNAPSHOT_EGRESS_DEBT_FLOOR_BYTES;
    seat.keyframe = true;
    this.requestDustSnapshot(seat);
  }

  isHeld(slot: number): boolean {
    return this.seats[slot]?.held === true;
  }

  /**
   * `visibility {hidden}`. `hidden:false` ALWAYS asks for a keyframe, also when the seat is already visible: it is the
   * client's resync request (protocol session keyframe contract, netcode.md section 7; no dedicated message exists).
   * The control edge rate-limits it (RATE_LIMITS.visibility, 1/s), so one client can force at most one keyframe a second.
   */
  setHidden(slot: number, hidden: boolean): void {
    const seat = this.seats[slot];
    if (seat?.active !== true) return;
    seat.hidden = hidden;
    if (!hidden) this.requestKeyframe(slot);
  }

  /**
   * Next frame of `slot` is a keyframe built from an EMPTY slot table: the client resets its table on every keyframe,
   * so every slot in interest is re-assigned and written FULL (otherwise records of already-assigned slots would
   * reference slots the client no longer knows and fail to decode).
   */
  requestKeyframe(slot: number): void {
    const seat = this.seats[slot];
    if (seat?.active !== true) return;
    seat.table.reset();
    seat.keyframe = true;
    this.requestDustSnapshot(seat);
  }

  setDustRadius(slot: number, radiusM: number): void {
    const seat = this.seats[slot];
    if (seat?.active !== true) return;
    seat.dustRadiusM = radiusM < 60 ? 60 : radiusM > 220 ? 220 : radiusM;
    this.configureDustScan(seat);
  }

  private configureDustScan(seat: Seat): void {
    const inM = seat.dustRadiusM + DUST_MARGIN_M;
    seat.dustScan.setRadius(this.dust, inM, inM + DUST_STREAM_HYSTERESIS_M);
  }

  /** Ticks since the seat's last non-neutral input (AFK rule, netcode.md section 10). */
  idleTicks(slot: number): number {
    const seat = this.seats[slot];
    return seat?.active === true ? this.sim.tick - seat.lastActiveTick : 0;
  }

  sequencer(slot: number): InputSequencer {
    return this.seats[slot]!.seq;
  }

  interestOf(slot: number, other: number): boolean {
    return this.seats[slot]?.interest[other] === 1;
  }

  // ---- inbound ------------------------------------------------------------------------------------------------------

  /** One INPUT message body (Colyseus bytes payload, without the 0x01 type byte). Never throws. */
  receiveInput(slot: number, body: Uint8Array, now: number): InputVerdict {
    const seat = this.seats[slot];
    if (seat?.active !== true || seat.held) return InputVerdict.NoSeat;
    if (!seat.inputBucket.take(now)) {
      this.counters.inputsRateLimited++;
      return InputVerdict.RateLimited;
    }
    const len = body.byteLength;
    const buf = len === this.in1.length - 1 ? this.in1 : len === this.in2.length - 1 ? this.in2 : undefined;
    if (buf === undefined) {
      this.counters.inputsMalformed++;
      return InputVerdict.Malformed;
    }
    buf.set(body, 1);
    if (!decodeInput(buf, this.batch)) {
      this.counters.inputsMalformed++;
      return InputVerdict.Malformed;
    }
    for (let i = 0; i < this.batch.count; i++) {
      const verdict = seat.seq.push(this.batch.inputs[i as 0 | 1]);
      if (verdict === InputAccept.Late) this.counters.inputsLate++;
      else if (verdict === InputAccept.TooFarAhead) this.counters.inputsTooFarAhead++;
    }
    return InputVerdict.Ok;
  }

  /** Queues a validated control intent; applied in arrival order at the next tick (section 3 step 2). */
  queueIntent(slot: number, intent: ControlIntent, reply?: (r: IntentResult) => void): void {
    if (this.seats[slot]?.active !== true) return;
    this.counters.intentsQueued++;
    this.intentQueue.push(reply === undefined ? { seat: slot, intent } : { seat: slot, intent, reply });
  }

  // ---- tick ---------------------------------------------------------------------------------------------------------

  /** True when the tick that just ran was a frame tick. */
  lastWasFrameTick = false;

  /** One fixed step of the room. */
  step(sink: ShiftSink): void {
    const sim = this.sim;
    // 1 Drain inputs.
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      const seat = this.seats[s]!;
      if (!seat.active) continue;
      const kind = seat.held ? ConsumeKind.Neutral : seat.seq.consume();
      if (kind === ConsumeKind.None) continue;
      const input = seat.seq.current;
      if (seat.held) {
        input.moveX = 0;
        input.moveY = 0;
        input.buttons = 0;
      }
      if (kind === ConsumeKind.Real && (input.moveX !== 0 || input.moveY !== 0 || input.buttons !== 0)) {
        seat.lastActiveTick = sim.tick;
      }
      sim.applyInput(s, input);
    }
    // 2 Control intents, arrival order.
    if (this.intentQueue.length > 0) {
      for (const q of this.intentQueue) {
        const result = sim.applyIntent(q.seat, q.intent);
        q.reply?.(result);
      }
      this.intentQueue.length = 0;
    }
    // 3 Simulate.
    sim.step(this.dt);
    // The sim has drained the ledger's Opened / Polished queues (Stamp payout, `plot.opened` / `plot.polished` into
    // `onSimEvent`). The dirty-plot list feeds the moon-wide `dust.plots` backlog, then is emptied per tick.
    this.collectDirtyPlots();
    // 4 Collect strokes.
    this.collectStrokes();
    // 5 Interest: ceil(seats / (SIM_TICK_HZ / 2)) seats per tick -> each seat every 0.5 s.
    const perTick = Math.max(1, Math.ceil(MAX_PLAYERS_PER_ROOM / Math.max(1, this.simTickHz >> 1)));
    for (let k = 0; k < perTick; k++) {
      const s = this.interestCursor;
      this.interestCursor = (s + 1) % MAX_PLAYERS_PER_ROOM;
      if (this.seats[s]!.active) {
        this.refreshInterest(s);
        this.refreshDustInterest(s);
      }
    }
    // 6 Frames.
    const tickDone = sim.tick - 1;
    this.lastWasFrameTick = tickDone % this.framesEvery === 0;
    if (this.lastWasFrameTick) {
      this.frameIndex++;
      this.prepareDeltas();
      for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
        const seat = this.seats[s]!;
        if (!seat.active || seat.held) continue;
        if (seat.hidden && !seat.keyframe && this.frameIndex % this.framesHidden !== 0) continue;
        const len = this.encodeFrame(s, tickDone);
        if (len > 0) {
          this.counters.framesSent++;
          sink.frame(s, this.bodyView(len));
        } else {
          this.counters.frameEncodeFailures++;
        }
      }
      this.strokes.clear();
      this.consumeDeltas();
      this.flushEvents(sink);
      // Dust bytes after the frames: every stroke up to `tickDone` is now on the wire (ordering rule, ./shift-dust).
      if (sink.bytes !== undefined) this.sendDust(sink, tickDone);
    }
  }

  // ---- dust sync ----------------------------------------------------------------------------------------------------

  /** DUST_REQUEST body (Colyseus bytes payload, without the 0x03 type byte). Answered on the next frame tick. */
  receiveDustRequest(slot: number, body: Uint8Array): boolean {
    const seat = this.seats[slot];
    if (seat?.active !== true || body.byteLength + 1 > this.requestMsg.length) return false;
    const msg = this.requestMsg.subarray(0, body.byteLength + 1);
    msg[0] = DUST_REQUEST_ID;
    msg.set(body, 1);
    const req = decodeDustRequest(msg, this.ledger.plotCount);
    if (req === null) {
      this.counters.dustRequestsInvalid++;
      return false;
    }
    this.counters.dustRequests++;
    if (req.kind === "plots") {
      const sent = this.sentOf(seat);
      for (const p of req.plotIds) {
        if (sent[p] === 2) continue;
        this.enqueue(seat, p);
      }
    } else if (this.pendingChecks.length < 2 * MAX_PLAYERS_PER_ROOM) {
      this.pendingChecks.push(slot, req.chunkId);
    }
    return true;
  }

  private requestDustSnapshot(seat: Seat): void {
    seat.dustSnapshot = true;
    seat.nextCheckTick = -1; // re-armed once the new snapshot is out
    seat.snapSlices = null; // a resync supersedes a snapshot still being paced out
    seat.snapNext = 0;
    seat.snapCount = 0; // and its recorded versions: the next unpaced snapshot must not reconcile against them
    seat.streamHead = seat.streamTail = 0;
    seat.dustSent?.fill(0);
    seat.dustScan.invalidate();
  }

  private sentOf(seat: Seat): Uint8Array {
    let sent = seat.dustSent;
    if (sent === null) {
      sent = new Uint8Array(this.ledger.plotCount);
      seat.dustSent = sent;
    }
    return sent;
  }

  private enqueue(seat: Seat, plot: number): void {
    if (seat.streamTail - seat.streamHead >= STREAM_QUEUE_MAX) {
      seat.dustScan.invalidate(); // full: a later interest pass picks it up
      return;
    }
    seat.streamQueue[seat.streamTail % STREAM_QUEUE_MAX] = plot;
    seat.streamTail++;
    this.sentOf(seat)[plot] = 2;
  }

  /** Streamed-ledger interest of `slot` (WDS 5.2): queue ledgers inside the dust radius, forget those beyond + 20 m. */
  private refreshDustInterest(slot: number): void {
    const seat = this.seats[slot]!;
    if (seat.dustSnapshot || seat.hidden || seat.held || seat.snapSlices !== null) {
      seat.dustScan.invalidate(); // streaming starts after the snapshot, which rewrites the marks
      return;
    }
    if (this.ledger.slotHigh === 0) return;
    const scan = seat.dustScan;
    // Typed-array scratch and cached centre directions inside the dust object; skipped while provably unchanged.
    const n = this.dust.scanInterest(scan, this.sim.avatar(slot), this.sentOf(seat));
    if (n === 0) return;
    const hits = this.dust.hitPlots;
    for (let i = 0; i < n; i++) this.enqueue(seat, hits[i]!);
  }

  private sendDust(sink: ShiftSink, tick: number): void {
    const send = sink.bytes!;
    const perFrame = DUST_STREAM_BYTES_PER_S / this.snapshotHz;
    const egressPerFrame = SNAPSHOT_EGRESS_BYTES_PER_S / this.snapshotHz;
    let snapshotBuilt = false;
    let checkBuilt = false;
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      const seat = this.seats[s]!;
      if (seat.active && seat.snapshotCredit < SNAPSHOT_EGRESS_BURST_BYTES) {
        seat.snapshotCredit = Math.min(SNAPSHOT_EGRESS_BURST_BYTES, seat.snapshotCredit + egressPerFrame);
      }
      if (!seat.active || seat.held || seat.hidden) {
        // hidden / held: the visible-again or reconnect resync asks for a fresh snapshot, so a half-sent one is dropped
        seat.snapSlices = null;
        seat.snapCount = 0;
        continue;
      }
      if (seat.snapSlices !== null) {
        this.pumpSnapshot(sink, s, seat); // streaming resumes only once the snapshot is complete
        continue;
      }
      if (seat.dustSnapshot) {
        if (tick - seat.lastSnapshotTick < SNAPSHOT_MIN_INTERVAL_S * this.simTickHz) continue;
        // At most one snapshot build per frame tick (M1-W3-T04): six seats resyncing together cost one build per frame
        // instead of a 6x spike in one tick; the others keep `dustSnapshot` and are served on the next frame ticks.
        if (snapshotBuilt) continue;
        if (seat.snapshotCredit <= 0) continue; // egress budget spent (F1): the request waits for the refill
        snapshotBuilt = true;
        seat.lastSnapshotTick = tick;
        const a = this.sim.avatar(s);
        const sent = this.sentOf(seat);
        sent.fill(0);
        seat.dustScan.invalidate();
        const snap = this.dust.buildSnapshot(a.px, a.py, a.pz, tick < 0 ? 0 : tick, sent);
        seat.dustSnapshot = false;
        if (snap === null) continue;
        this.lastSnapshot = snap;
        this.counters.dustSnapshotsSent++;
        this.counters.dustSnapshotBytes += snap.deflatedBytes + snap.slices.length;
        seat.snapshotCredit = Math.max(
          SNAPSHOT_EGRESS_DEBT_FLOOR_BYTES,
          seat.snapshotCredit - (snap.deflatedBytes + snap.slices.length),
        );
        seat.snapSlices = snap.slices;
        seat.snapNext = 0;
        this.pumpSnapshot(sink, s, seat);
        if (seat.snapSlices !== null) {
          this.counters.dustSnapshotsPaced++;
          this.recordSnapshotVersions(seat);
        }
        continue;
      }
      seat.streamCredit = Math.min(seat.streamCredit + perFrame, 2 * perFrame);
      const sent = seat.dustSent;
      while (sent !== null && seat.streamHead < seat.streamTail && seat.streamCredit > 0) {
        const plot = seat.streamQueue[seat.streamHead % STREAM_QUEUE_MAX]!;
        seat.streamHead++;
        if (sent[plot] !== 2) continue;
        const body = this.dust.ledgerBody(plot);
        sent[plot] = body === null ? 0 : 1;
        seat.dustScan.invalidate(); // a streamed ledger outside the radius (request) is forgotten by the next pass
        if (body === null) continue; // Polished (or never touched) since queued: `dust.plots` carries the state
        send(s, DUST_LEDGER_ID, body);
        seat.streamCredit -= body.byteLength + 1;
        this.counters.dustLedgersStreamed++;
        this.counters.dustLedgerBytes += body.byteLength + 1;
      }
      // 5 s DUST_CHECK chunks summary (WDS 5.1): armed on the first idle frame tick after a snapshot, at most ONE build
      // per frame tick across seats (a seat that is due while another built waits for the next frame tick).
      if (sent === null) continue;
      if (seat.nextCheckTick < 0) seat.nextCheckTick = tick + this.checkEveryTicks;
      else if (!checkBuilt && tick >= seat.nextCheckTick) {
        checkBuilt = true;
        seat.nextCheckTick = tick + this.checkEveryTicks;
        const body = this.dust.chunkCheckBody(sent);
        if (body !== null) send(s, DUST_CHECK_ID, body);
      }
    }
    const checks = this.pendingChecks;
    for (let i = 0; i + 1 < checks.length; i += 2) {
      const slot = checks[i]!;
      const sent = this.seats[slot]?.active === true ? this.seats[slot]!.dustSent : null;
      if (sent === null) continue; // no snapshot yet: the client has nothing to compare, and "all plots" must not be listed (F2)
      const body = this.dust.checkDetailBody(checks[i + 1]!, sent);
      if (body !== null) send(slot, DUST_CHECK_ID, body);
    }
    checks.length = 0;
  }

  /**
   * Sends as many of the seat's pending snapshot slices as fit under the bulk-send ceiling (socket buffered bytes plus
   * what this call already sent), oldest first, and finishes the snapshot when the last one is out. Allocation-free;
   * costs nothing for seats without a pending snapshot. A healthy client has an empty buffer, so a typical snapshot
   * (15-25 KB) still leaves in one tick (the ordering rule of ./shift-dust holds); only a snapshot larger than the
   * headroom, or a slow socket, spreads over later frame ticks as the buffer drains.
   */
  private pumpSnapshot(sink: ShiftSink, slot: number, seat: Seat): void {
    const slices = seat.snapSlices!;
    const send = sink.bytes!;
    let used = sink.buffered === undefined ? 0 : sink.buffered(slot);
    const first = seat.snapNext;
    while (seat.snapNext < slices.length) {
      const body = slices[seat.snapNext]!;
      const cost = body.byteLength + WS_SEND_OVERHEAD_BYTES;
      if (used + cost > this.bulkCeiling) break;
      send(slot, DUST_SNAPSHOT_ID, body);
      used += cost;
      seat.snapNext++;
    }
    if (seat.snapNext < slices.length) {
      if (seat.snapNext === first) this.counters.dustSnapshotPauses++;
      return;
    }
    seat.snapSlices = null;
    seat.snapNext = 0;
    seat.streamCredit = 0;
    this.forgetStaleSnapshotLedgers(seat);
    this.refreshDustInterest(slot);
  }

  /**
   * A snapshot that needs more than one tick leaves a window in which the frames carry strokes the client skips (it
   * applies none before the snapshot installs). Remember each snapshot ledger's version when pacing starts...
   */
  private recordSnapshotVersions(seat: Seat): void {
    const l = this.ledger;
    const sent = seat.dustSent!;
    seat.snapPlots ??= new Int32Array(DUST_SNAPSHOT_MAX_LEDGERS);
    seat.snapVersions ??= new Uint32Array(DUST_SNAPSHOT_MAX_LEDGERS);
    let n = 0;
    for (let s = 0; s < l.slotHigh && n < DUST_SNAPSHOT_MAX_LEDGERS; s++) {
      const plot = l.plotOfSlot[s]!;
      if (plot < 0 || sent[plot] !== 1) continue;
      seat.snapPlots[n] = plot;
      seat.snapVersions[n] = l.version[s]!;
      n++;
    }
    seat.snapCount = n;
  }

  /**
   * ...and when the last slice is out, forget every one that changed meanwhile (`sent` = 0): the interest pass that
   * follows re-queues it as a DUST_LEDGER, which replaces the stale copy. Residual, counted in `dustSnapshotStale`: a
   * plot that was Polished meanwhile has no ledger left to send, so the client keeps its old ledger until its next
   * snapshot (cosmetic; the sim and the server stay authoritative).
   */
  private forgetStaleSnapshotLedgers(seat: Seat): void {
    const l = this.ledger;
    const sent = seat.dustSent;
    const plots = seat.snapPlots;
    const versions = seat.snapVersions;
    if (sent === null || plots === null || versions === null) return;
    for (let i = 0; i < seat.snapCount; i++) {
      const plot = plots[i]!;
      if (sent[plot] !== 1) continue;
      const slot = l.slotOf[plot]!;
      if (slot < 0) this.counters.dustSnapshotStale++;
      else if (l.version[slot] !== versions[i]) {
        sent[plot] = 0;
        seat.dustScan.invalidate();
        this.counters.dustSnapshotCatchUps++;
      }
    }
    seat.snapCount = 0;
  }

  /** Moves this tick's dirty plots into the moon-wide `dust.plots` backlog (deduplicated), then empties the list. */
  private collectDirtyPlots(): void {
    const l = this.ledger;
    const n = l.dirtyPlotCount;
    if (n > 0) this.dust.noteDirty(); // the moon-wide snapshot cache is stale (./shift-dust)
    for (let k = 0; k < n; k++) {
      const p = l.dirtyPlotAt(k);
      if (this.deltaFlag[p] === 1) continue;
      this.deltaFlag[p] = 1;
      if (this.deltaN === this.deltaList.length) {
        const g = new Int32Array(this.deltaList.length * 2); // rare: a burst of changed plots
        g.set(this.deltaList);
        this.deltaList = g;
      }
      this.deltaList[this.deltaN++] = p;
    }
    l.clearDirtyPlots();
  }

  /** On frames that carry `dust.plots`: fills `deltaOut` from the backlog head with the current state and L0 byte. */
  private prepareDeltas(): void {
    const out = this.deltaOut;
    out.count = 0;
    if (this.deltaN === 0 || this.frameIndex % this.plotsEvery !== 0) return;
    const l = this.ledger;
    const n = Math.min(this.deltaN, PLOT_DELTAS_PER_FRAME, out.plotId.length);
    for (let i = 0; i < n; i++) {
      const p = this.deltaList[i]!;
      out.plotId[i] = p;
      out.state[i] = l.state[p]! & 3;
      out.remainingFrac[i] = l.frac[p]!;
    }
    out.count = n;
  }

  /** Drops the deltas written this frame from the backlog head. */
  private consumeDeltas(): void {
    const n = this.deltaOut.count;
    if (n === 0) return;
    for (let i = 0; i < n; i++) this.deltaFlag[this.deltaList[i]!] = 0;
    this.deltaList.copyWithin(0, n, this.deltaN);
    this.deltaN -= n;
    this.deltaOut.count = 0;
  }

  /** `dust.plots` backlog length (tests, ops). */
  get plotDeltaBacklog(): number {
    return this.deltaN;
  }

  // ---- internals ----------------------------------------------------------------------------------------------------

  /** Cached `buffer.subarray(1, len)` views of the writer buffer (one per length, created once): no view per send. */
  private readonly views: (Uint8Array | undefined)[] = [];

  private bodyView(len: number): Uint8Array {
    let v = this.views[len];
    if (v === undefined) {
      v = this.writer.buffer.subarray(1, len);
      this.views[len] = v;
    }
    return v;
  }

  private onSimEvent(e: RoomSimEvent): void {
    if (e.name === "dust.collected") return; // derived by the client from Self cellGrams (netcode.md section 4.3)
    this.pendingEvents.push(e as WireSimEvent);
  }

  private flushEvents(sink: ShiftSink): void {
    const pending = this.pendingEvents;
    if (pending.length === 0) return;
    if (sink.events === undefined) {
      pending.length = 0;
      return;
    }
    const batch = this.eventBatch;
    batch.length = 0;
    const n = Math.min(pending.length, SIM_EVENTS_BATCH_MAX);
    for (let i = 0; i < n; i++) batch.push(pending[i]!);
    // The rest spill to the next frame tick (shifted in place: no array from splice).
    const rest = pending.length - n;
    for (let i = 0; i < rest; i++) pending[i] = pending[i + n]!;
    pending.length = rest;
    sink.events(batch);
  }

  private collectStrokes(): void {
    const sim = this.sim;
    const n = sim.strokeCount;
    for (let k = 0; k < n; k++) {
      const r = sim.strokeAt(k);
      const i = this.strokes.addChain(
        r.anchor,
        r.startUMm,
        r.startVMm,
        r.endUMm,
        r.endVMm,
        r.widthCm,
        r.depth16,
        r.toolCode,
        r.actorSlot,
        r.tick,
        r.inputSeq,
      );
      if (i < 0) {
        this.counters.strokesDropped++;
        continue;
      }
      const a = sim.avatar(r.actorSlot);
      this.strokePos[i * 3] = a.px;
      this.strokePos[i * 3 + 1] = a.py;
      this.strokePos[i * 3 + 2] = a.pz;
    }
  }

  /** Horizon-aware entity interest of `slot` (section 7), with leave hysteresis. */
  private refreshInterest(slot: number): void {
    const seat = this.seats[slot]!;
    const me = this.sim.avatar(slot);
    const limit = Math.min(ENTITY_INTEREST_MAX_M, 2 * this.visPerSide + INTEREST_MARGIN_M);
    for (let o = 0; o < MAX_PLAYERS_PER_ROOM; o++) {
      if (o === slot || !this.seats[o]!.active) {
        seat.interest[o] = 0;
        continue;
      }
      const other = this.sim.avatar(o);
      const dx = other.px - me.px;
      const dy = other.py - me.py;
      const dz = other.pz - me.pz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const was = seat.interest[o] === 1;
      seat.interest[o] = d <= (was ? limit + ENTITY_INTEREST_HYSTERESIS_M : limit) ? 1 : 0;
    }
  }

  private bodyYawCode(a: Readonly<AvatarState>): number {
    const b = this.basis;
    headingBasis(a as AvatarState, b);
    const north = a.fx * b[3]! + a.fy * b[4]! + a.fz * b[5]!;
    const east = a.fx * b[6]! + a.fy * b[7]! + a.fz * b[8]!;
    return yawToCode(atan2Det(east, north));
  }

  /** Encodes the FRAME of `slot` into the shared writer. Returns its length (0 on failure). */
  private encodeFrame(slot: number, tick: number): number {
    const sim = this.sim;
    const seat = this.seats[slot]!;
    const w = this.writer;
    const table = seat.table;
    const keyframe = seat.keyframe;
    w.begin(tick < 0 ? 0 : tick, seat.seq.lastConsumedSeq, seat.seq.depth, keyframe);
    // Self.
    const a = sim.avatar(slot);
    const t = sim.toolState(slot);
    const s = this.self;
    s.moveState = a.moveState;
    s.hopCharges = a.hopCharges;
    s.px = a.px;
    s.py = a.py;
    s.pz = a.pz;
    s.vx = a.vx;
    s.vy = a.vy;
    s.vz = a.vz;
    s.yawCode = this.bodyYawCode(a);
    s.cellGrams = t.cellGrams[t.toolCode] ?? 0;
    if (!w.writeSelf(s)) return w.finish();
    if (seat.hidden && !keyframe) return this.finishFrame(seat);
    // SlotChanges (wire order), then entities. Slot = actor slot (avatars only in the MVP room).
    for (let o = 0; o < MAX_PLAYERS_PER_ROOM; o++) {
      if (o === slot) continue;
      const want = seat.interest[o] === 1 && this.seats[o]!.active;
      const assigned = table.kind[o] !== -1;
      if (want && !assigned) w.slotAssign(table, o, o + 1, ENTITY_KIND_AVATAR);
      else if (!want && assigned) w.slotRelease(table, o);
    }
    const kfEvery = this.keyframeEvery;
    for (let o = 0; o < MAX_PLAYERS_PER_ROOM; o++) {
      if (o === slot || table.kind[o] !== ENTITY_KIND_AVATAR) continue;
      // Staggered keyframe: slot o is refreshed when (frameIndex + o) mod (5 x SNAPSHOT_HZ) == 0.
      if (keyframe || (this.frameIndex + o) % kfEvery === 0) table.needsFull[o] = 1;
      this.fillEntity(o);
      if (!w.writeEntity(table, this.ent)) table.needsFull[o] = 1; // spilled: FULL next frame
    }
    // DustStrokes: own echoes always; others inside the dust radius + margin.
    const src = this.strokes;
    if (src.chainCount > 0) {
      const dst = this.strokeScratch;
      dst.clear();
      const r = seat.dustRadiusM + DUST_MARGIN_M;
      const r2 = r * r;
      for (let i = 0; i < src.chainCount; i++) {
        const author = src.actorSlot[i]!;
        if (author !== slot) {
          const dx = this.strokePos[i * 3]! - a.px;
          const dy = this.strokePos[i * 3 + 1]! - a.py;
          const dz = this.strokePos[i * 3 + 2]! - a.pz;
          if (dx * dx + dy * dy + dz * dz > r2) continue;
        }
        dst.addChain(
          src.anchor[i]!,
          src.startUMm[i]!,
          src.startVMm[i]!,
          src.endUMm[i]!,
          src.endVMm[i]!,
          src.widthCm[i]!,
          src.depth16[i]!,
          src.toolCode[i]!,
          author,
          src.tick[i]!,
          src.inputSeq[i]!,
        );
      }
      if (dst.chainCount > 0) {
        const written = w.writeStrokes(dst, 0, tick < 0 ? 0 : tick);
        if (written < dst.chainCount) this.counters.strokesDropped += dst.chainCount - written;
      }
    }
    // DustPlots (moon-wide L0 deltas, 2 Hz): the same list for every client.
    const deltas = this.deltaOut;
    if (deltas.count > 0) {
      const written = w.writeDustPlots(deltas, 0);
      this.counters.plotDeltasSent += written;
      if (written < deltas.count) this.counters.plotDeltasDropped += deltas.count - written;
    }
    return this.finishFrame(seat);
  }

  private finishFrame(seat: Seat): number {
    const len = this.writer.finish();
    if (len > 0) seat.keyframe = false;
    return len;
  }

  private fillEntity(slot: number): void {
    const a = this.sim.avatar(slot);
    const t = this.sim.toolState(slot);
    const e = this.ent;
    e.slot = slot;
    e.rec = REC_DELTA;
    e.kind = ENTITY_KIND_AVATAR;
    e.px = a.px;
    e.py = a.py;
    e.pz = a.pz;
    e.yawCode = this.bodyYawCode(a);
    e.pitchCode = pitchToCode(inputPitchToRadians(this.seats[slot]!.seq.current.pitch));
    e.actionState = t.detailing
      ? ACTION.detailing
      : t.sweeping
        ? ACTION.sweep
        : a.moveState !== MOVE_GROUNDED
          ? ACTION.airborne
          : ACTION.none;
    e.toolIndex = t.toolCode;
    e.flags = t.inContact ? 1 << AVATAR_FLAG_BIT.cleaning : 0;
  }
}
