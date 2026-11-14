// Mutable, reusable state objects of the FRAME codec: the Self block, one entity record, the per-client slot table and
// the pooled decoded frame (`FrameView`). Everything is preallocated at a fixed capacity; encoder and decoder write and
// read these objects in place, so the hot path allocates nothing (netcode.md section 4.2, task M1-W4-T01).
//
// Units: positions are metres and velocities m/s (floats, exactly `q * resolution` after a decode); angles, state ids,
// gauges, steering and orientation components stay the integer codes of their wire field (`yawCode`, `pitchCode`, ...)
// so two hosts compare bit for bit (frame.ts "Decoded values").
//
// PROPOSAL (not a contract): the hot-path frame source. `RoomSim.snapshot()` is the cold path. The sim should expose
// reusable-buffer readers that fill the structs below (see `FrameSource`), plus an interest-set iteration owned by
// `apps/server/src/net` (InterestService), which this package does not implement.

import {
  AVATAR_ACTION_STATES,
  FRAME_SELF_DRIVER_MOVE_STATE,
  MOVE_STATES,
  ROBOT_UI_STATES,
  VEHICLE_GEARS,
} from "@moon-cleanup/shared";

export const MAX_SLOTS = 255;
export const SLOT_NONE = 255;

/** Largest entity record count one decoded FRAME may carry (slot caps: 16 avatars + 32 vehicles + 64 robots = 112). */
export const FRAME_MAX_ENTITY_RECORDS = 128;
export const FRAME_MAX_SLOT_CHANGES = 255;
export const FRAME_MAX_DUST_PLOT_DELTAS = 250;
export const FRAME_MAX_ROBOT_INTENTS = 48;
/** Stroke chain capacity of one FRAME (a 17 B header makes 58 the physical maximum in 1,000 B). */
export const FRAME_MAX_STROKE_CHAINS = 64;
export const FRAME_MAX_STROKE_CONTINUATIONS = 256;

export const ENTITY_KIND_AVATAR = 0;
export const ENTITY_KIND_VEHICLE = 1;
export const ENTITY_KIND_ROBOT = 2;
export const REC_FULL = 0;
export const REC_DELTA = 1;
export const REC_REMOVE = 2;

export const SLOT_OP_RELEASE = 0;
export const SLOT_OP_ASSIGN = 1;

export const AVATAR_ACTION_STATE_MAX = AVATAR_ACTION_STATES.length - 1;
export const ROBOT_STATE_MAX = ROBOT_UI_STATES.length - 1;
export const MOVE_STATE_MAX = MOVE_STATES.length - 1;
export const MOVE_STATE_SEATED_DRIVER = FRAME_SELF_DRIVER_MOVE_STATE;
export const GEAR_MAX = VEHICLE_GEARS.length - 1;

/**
 * Self block (own avatar, plus vehicle while `moveState` is `seated_driver`). Used as encoder input and decoder
 * output. Codes are integers of the wire width; see QUANT in @moon-cleanup/shared.
 */
export interface SelfState {
  /** Index into MOVE_STATES (0 .. 5; 5 bits on the wire). */
  moveState: number;
  hopCharges: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  yawCode: number;
  /** Dust Cell grams, u24 (`dust.ack`). */
  cellGrams: number;
  // ---- vehicle block (meaningful only while moveState === MOVE_STATE_SEATED_DRIVER) ----
  vpx: number;
  vpy: number;
  vpz: number;
  /** Dropped quaternion component (0 x, 1 y, 2 z, 3 w). */
  orientIndex: number;
  /** Three 15-bit signed components (smallest-three). */
  orientA: number;
  orientB: number;
  orientC: number;
  lvx: number;
  lvy: number;
  lvz: number;
  avx: number;
  avy: number;
  avz: number;
  /** i8 steering code (-128 .. 127). */
  steer: number;
  /** Index into VEHICLE_GEARS (2 bits). */
  gear: number;
  boost: boolean;
  lights: boolean;
}

export function createSelfState(): SelfState {
  return {
    moveState: 0,
    hopCharges: 0,
    px: 0,
    py: 0,
    pz: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yawCode: 0,
    cellGrams: 0,
    vpx: 0,
    vpy: 0,
    vpz: 0,
    orientIndex: 0,
    orientA: 0,
    orientB: 0,
    orientC: 0,
    lvx: 0,
    lvy: 0,
    lvz: 0,
    avx: 0,
    avy: 0,
    avz: 0,
    steer: 0,
    gear: 0,
    boost: false,
    lights: false,
  };
}

/**
 * One entity record (avatar, vehicle or robot share the struct; the slot table says which fields are meaningful).
 * Encoder input: `rec` is the REQUESTED record type (a delta of a slot that needs a keyframe is upgraded to full).
 * Decoder output: `rec` is what was on the wire; `px/py/pz` are the resolved absolute position either way.
 */
export interface EntityState {
  slot: number;
  /** REC_FULL, REC_DELTA or REC_REMOVE. */
  rec: number;
  /** ENTITY_KIND_*; set by the decoder from the slot table, by the encoder from the slot table too. */
  kind: number;
  px: number;
  py: number;
  pz: number;
  /** Decoder only: the wire delta of a DELTA record, class and steps per axis (for tests and tooling). */
  dClsX: number;
  dClsY: number;
  dClsZ: number;
  dStepsX: number;
  dStepsY: number;
  dStepsZ: number;
  // avatar
  yawCode: number;
  pitchCode: number;
  actionState: number;
  toolIndex: number;
  /** Avatar flags (6 bits) or vehicle flags (8 bits). */
  flags: number;
  // vehicle
  orientIndex: number;
  orientA: number;
  orientB: number;
  orientC: number;
  steerCode: number;
  speedCode: number;
  driverSlot: number;
  // robot
  headingCode: number;
  robotState: number;
  cargo: number;
}

export function createEntityState(): EntityState {
  return {
    slot: 0,
    rec: REC_FULL,
    kind: ENTITY_KIND_AVATAR,
    px: 0,
    py: 0,
    pz: 0,
    dClsX: 0,
    dClsY: 0,
    dClsZ: 0,
    dStepsX: 0,
    dStepsY: 0,
    dStepsZ: 0,
    yawCode: 0,
    pitchCode: 0,
    actionState: 0,
    toolIndex: 0,
    flags: 0,
    orientIndex: 0,
    orientA: 0,
    orientB: 0,
    orientC: 0,
    steerCode: 0,
    speedCode: 0,
    driverSlot: 0,
    headingCode: 0,
    robotState: 0,
    cargo: 0,
  };
}

/**
 * Per-client slot table (netcode.md section 4.2): slot 0 .. 254 maps to an entity id and kind. The server keeps one
 * per client and the client keeps one per connection; both apply the same SlotChanges so they never drift. It also
 * holds the last position each side knows of every slot (quantized 20-bit steps), the base of DELTA records.
 */
export class SlotTable {
  /** -1 = free, else ENTITY_KIND_*. */
  readonly kind = new Int8Array(MAX_SLOTS).fill(-1);
  readonly entityId = new Uint32Array(MAX_SLOTS);
  /** Last known quantized position (6.25 mm steps) per slot. */
  readonly stepsX = new Int32Array(MAX_SLOTS);
  readonly stepsY = new Int32Array(MAX_SLOTS);
  readonly stepsZ = new Int32Array(MAX_SLOTS);
  /** Encoder only: 1 while the slot needs a FULL record (new, or skipped by the frame size cap). */
  readonly needsFull = new Uint8Array(MAX_SLOTS);
  count = 0;

  reset(): void {
    this.kind.fill(-1);
    this.entityId.fill(0);
    this.stepsX.fill(0);
    this.stepsY.fill(0);
    this.stepsZ.fill(0);
    this.needsFull.fill(0);
    this.count = 0;
  }

  isUsed(slot: number): boolean {
    return slot >= 0 && slot < MAX_SLOTS && this.kind[slot] !== -1;
  }

  /** Lowest free slot, or -1 when the table is full. */
  findFree(): number {
    for (let s = 0; s < MAX_SLOTS; s++) if (this.kind[s] === -1) return s;
    return -1;
  }

  /** Slot currently holding `entityId`, or -1. Linear (<= 255 entries, called per interest change, not per entity record). */
  findEntity(entityId: number): number {
    for (let s = 0; s < MAX_SLOTS; s++) if (this.kind[s] !== -1 && this.entityId[s] === entityId) return s;
    return -1;
  }

  assign(slot: number, entityId: number, kind: number): void {
    if (this.kind[slot] === -1) this.count++;
    this.kind[slot] = kind;
    this.entityId[slot] = entityId;
    this.stepsX[slot] = 0;
    this.stepsY[slot] = 0;
    this.stepsZ[slot] = 0;
    this.needsFull[slot] = 1;
  }

  release(slot: number): void {
    if (this.kind[slot] !== -1) this.count--;
    this.kind[slot] = -1;
    this.entityId[slot] = 0;
    this.needsFull[slot] = 0;
  }
}

/** Decoded SlotChanges (struct of arrays). */
export class SlotChangeList {
  count = 0;
  readonly slot = new Uint8Array(FRAME_MAX_SLOT_CHANGES);
  /** SLOT_OP_ASSIGN or SLOT_OP_RELEASE. */
  readonly op = new Uint8Array(FRAME_MAX_SLOT_CHANGES);
  readonly entityId = new Uint32Array(FRAME_MAX_SLOT_CHANGES);
  readonly kind = new Uint8Array(FRAME_MAX_SLOT_CHANGES);
}

/** Decoded `robot.plot` intents (struct of arrays). */
export class RobotIntentList {
  count = 0;
  readonly robotId = new Uint16Array(FRAME_MAX_ROBOT_INTENTS);
  readonly plotId = new Uint32Array(FRAME_MAX_ROBOT_INTENTS);
  readonly startTick = new Uint32Array(FRAME_MAX_ROBOT_INTENTS);
  readonly widthCm = new Uint16Array(FRAME_MAX_ROBOT_INTENTS);
  readonly depth16 = new Uint8Array(FRAME_MAX_ROBOT_INTENTS);
  readonly speedCmPerS = new Uint16Array(FRAME_MAX_ROBOT_INTENTS);
  readonly laneMaskLow = new Uint32Array(FRAME_MAX_ROBOT_INTENTS);
  readonly laneMaskHigh = new Uint32Array(FRAME_MAX_ROBOT_INTENTS);
}

/** Decoded `dust.plots` deltas (struct of arrays). */
export class DustPlotDeltaList {
  count = 0;
  readonly plotId = new Uint32Array(FRAME_MAX_DUST_PLOT_DELTAS);
  readonly state = new Uint8Array(FRAME_MAX_DUST_PLOT_DELTAS);
  readonly remainingFrac = new Uint8Array(FRAME_MAX_DUST_PLOT_DELTAS);
}

/**
 * Pooled stroke chains: struct of arrays, one entry per chain header plus one flat continuation list. Used as encoder
 * input (the server fills it per client per frame), decoder output, and for `dust.log`. Capacities are fixed at
 * construction so a decoder never allocates from an untrusted count.
 */
export class StrokeChainBuffer {
  chainCount = 0;
  continuationCount = 0;
  readonly maxChains: number;
  readonly maxContinuations: number;
  readonly anchor: Uint32Array;
  readonly startUMm: Int16Array;
  readonly startVMm: Int16Array;
  readonly endUMm: Int16Array;
  readonly endVMm: Int16Array;
  readonly widthCm: Uint16Array;
  readonly depth16: Uint8Array;
  readonly toolCode: Uint8Array;
  readonly actorSlot: Uint8Array;
  readonly tick: Uint32Array;
  readonly inputSeq: Uint16Array;
  /** Index of the chain's first continuation in the flat lists. */
  readonly contStart: Uint16Array;
  readonly contCount: Uint8Array;
  readonly contDxMm: Int16Array;
  readonly contDyMm: Int16Array;

  constructor(maxChains: number, maxContinuations: number) {
    this.maxChains = maxChains;
    this.maxContinuations = maxContinuations;
    this.anchor = new Uint32Array(maxChains);
    this.startUMm = new Int16Array(maxChains);
    this.startVMm = new Int16Array(maxChains);
    this.endUMm = new Int16Array(maxChains);
    this.endVMm = new Int16Array(maxChains);
    this.widthCm = new Uint16Array(maxChains);
    this.depth16 = new Uint8Array(maxChains);
    this.toolCode = new Uint8Array(maxChains);
    this.actorSlot = new Uint8Array(maxChains);
    this.tick = new Uint32Array(maxChains);
    this.inputSeq = new Uint16Array(maxChains);
    this.contStart = new Uint16Array(maxChains);
    this.contCount = new Uint8Array(maxChains);
    this.contDxMm = new Int16Array(maxContinuations);
    this.contDyMm = new Int16Array(maxContinuations);
  }

  clear(): void {
    this.chainCount = 0;
    this.continuationCount = 0;
  }

  /** Starts a chain (header record). Returns its index, or -1 when full. */
  addChain(
    anchor: number,
    startUMm: number,
    startVMm: number,
    endUMm: number,
    endVMm: number,
    widthCm: number,
    depth16: number,
    toolCode: number,
    actorSlot: number,
    tick: number,
    inputSeq: number,
  ): number {
    const i = this.chainCount;
    if (i >= this.maxChains) return -1;
    this.anchor[i] = anchor;
    this.startUMm[i] = startUMm;
    this.startVMm[i] = startVMm;
    this.endUMm[i] = endUMm;
    this.endVMm[i] = endVMm;
    this.widthCm[i] = widthCm;
    this.depth16[i] = depth16;
    this.toolCode[i] = toolCode;
    this.actorSlot[i] = actorSlot;
    this.tick[i] = tick;
    this.inputSeq[i] = inputSeq;
    this.contStart[i] = this.continuationCount;
    this.contCount[i] = 0;
    this.chainCount = i + 1;
    return i;
  }

  /** Appends a continuation to the LAST chain. Returns false when full or the chain already has 255. */
  addContinuation(dxMm: number, dyMm: number): boolean {
    const chain = this.chainCount - 1;
    if (chain < 0) return false;
    const n = this.continuationCount;
    const have = this.contCount[chain] ?? 0;
    if (n >= this.maxContinuations || have >= 255) return false;
    this.contDxMm[n] = dxMm;
    this.contDyMm[n] = dyMm;
    this.contCount[chain] = have + 1;
    this.continuationCount = n + 1;
    return true;
  }
}

/**
 * A decoded FRAME, reused across frames. All capacities are fixed; a frame that exceeds one fails to decode with
 * `FRAME_ERR_CAPACITY` instead of growing anything.
 */
export class FrameView {
  serverTick = 0;
  ackInputSeq = 0;
  inputBufferDepth = 0;
  /** Raw flags byte. */
  flags = 0;
  keyframe = false;
  /** Bytes of an events section that was present and skipped (the MVP server never sends one). */
  skippedEventsBytes = 0;
  readonly self: SelfState = createSelfState();
  readonly slotChanges = new SlotChangeList();
  entityCount = 0;
  readonly entities: readonly EntityState[] = Array.from({ length: FRAME_MAX_ENTITY_RECORDS }, createEntityState);
  readonly strokes = new StrokeChainBuffer(FRAME_MAX_STROKE_CHAINS, FRAME_MAX_STROKE_CONTINUATIONS);
  readonly robotIntents = new RobotIntentList();
  readonly dustPlots = new DustPlotDeltaList();

  /** Presence of a section after the last decode (mirrors the flags, but only for sections that decoded). */
  hasSlotChanges = false;
  hasEntities = false;
  hasStrokes = false;
  hasRobotIntents = false;
  hasDustPlots = false;
  hasEvents = false;

  reset(): void {
    this.serverTick = 0;
    this.ackInputSeq = 0;
    this.inputBufferDepth = 0;
    this.flags = 0;
    this.keyframe = false;
    this.skippedEventsBytes = 0;
    this.slotChanges.count = 0;
    this.entityCount = 0;
    this.strokes.clear();
    this.robotIntents.count = 0;
    this.dustPlots.count = 0;
    this.hasSlotChanges = false;
    this.hasEntities = false;
    this.hasStrokes = false;
    this.hasRobotIntents = false;
    this.hasDustPlots = false;
    this.hasEvents = false;
  }
}

/**
 * The hot-path frame source PROPOSAL, as an interface local to this package. The sim (or an adapter in
 * apps/server/src/net over it) implements it with reusable buffers; the room never calls `RoomSim.snapshot()` per
 * frame. All methods fill caller-owned structs and return a status, so a frame costs no allocation.
 */
export interface FrameSource {
  /**
   * Fills `out` with the actor's own avatar and, while driving, its vehicle (already quantized at tick end, so the
   * client replay starts bit-identical). Returns false when the actor is not seated in the room.
   */
  readSelf(actor: number, out: SelfState): boolean;
  /**
   * Fills `out` with the current state of the entity `entityId` (kind-specific fields, `px/py/pz`). Returns the
   * ENTITY_KIND_* code, or -1 when the entity no longer exists.
   */
  readEntity(entityId: number, out: EntityState): number;
}
