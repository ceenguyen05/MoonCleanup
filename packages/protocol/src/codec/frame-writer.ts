// FRAME encoder (server -> client, bytes 0x20). Layout and bit tables: protocol/frame.ts in @moon-cleanup/shared;
// section semantics: netcode.md sections 4.2 and 4.5; dust sections: dust-wire.ts.
//
// `FrameWriter` owns one preallocated buffer (FRAME_MAX_BYTES) and is reused for every frame of every client: call
// `begin`, `writeSelf`, then the optional sections in wire order (slot changes, entities, strokes, robot intents, dust
// plots), then `finish`. Nothing allocates. Every section writer checks that the record fits BEFORE writing and
// returns false (nothing written) when it does not, so the caller can defer the record to the next frame (the
// "spill" rule of netcode.md section 4.2): FULL entity records and stroke chains are atomic.
//
// The encoder never throws; misuse (sections out of order, a missing `begin`) makes the call return false and `finish`
// return 0.

import {
  FRAME_FLAG_BIT,
  FRAME_HEADER_BYTES,
  FRAME_MAX_BYTES,
  FRAME_SECTION_LENGTH_BYTES,
  FRAME_TYPE_ID,
  QUANT,
} from "@moon-cleanup/shared";
import { BitWriter } from "./bits";
import {
  DUST_PLOT_DELTA_BYTES,
  ROBOT_INTENT_BYTES,
  strokeChainBytes,
  writeDustPlotDelta,
  writeRobotIntent,
  writeStrokeChain,
} from "./dust-wire";
import {
  ENTITY_KIND_AVATAR,
  ENTITY_KIND_ROBOT,
  ENTITY_KIND_VEHICLE,
  MOVE_STATE_MAX,
  MOVE_STATE_SEATED_DRIVER,
  REC_DELTA,
  REC_FULL,
  REC_REMOVE,
  SLOT_OP_ASSIGN,
  SLOT_OP_RELEASE,
  type DustPlotDeltaList,
  type EntityState,
  type RobotIntentList,
  type SelfState,
  type SlotTable,
  type StrokeChainBuffer,
} from "./frame-state";
import { POS_OTHERS_MAX, POS_OTHERS_MIN, clampRound, posOthersStepsAt, posOwnStepsAt, velStepsAt } from "./quantize";
import { viewOf } from "./view";

export const SLOT_CHANGE_BYTES = 6;
/** Bytes of a Self block on foot / driving (162 and 389 bits). */
export const SELF_ON_FOOT_BYTES = 21;
export const SELF_DRIVING_BYTES = 49;

/** Section indexes in wire order after Self. */
const SEC_SLOTS = 1;
const SEC_ENTITIES = 2;
const SEC_STROKES = 3;
const SEC_ROBOTS = 4;
const SEC_PLOTS = 5;
const SEC_FLAG_NAMES = [
  null,
  FRAME_FLAG_BIT.hasSlotChanges,
  FRAME_FLAG_BIT.hasEntities,
  FRAME_FLAG_BIT.hasStrokes,
  FRAME_FLAG_BIT.hasRobotIntents,
  FRAME_FLAG_BIT.hasDustPlots,
] as const;

/** Body bits of an entity record by kind (after the prefix and position). */
export const AVATAR_BODY_BITS = QUANT.yaw.bits + QUANT.pitch.bits + 6 + 4 + 6;
export const VEHICLE_BODY_BITS = 2 + 3 * 10 + 6 + 8 + 8 + 8;
export const ROBOT_BODY_BITS = 8 + 4 + 3;

const POS_BITS = QUANT.positionOthers.bits;
const CLASS_AXIS_BITS = QUANT.positionDelta.classAxisBits;

function bodyBits(kind: number): number {
  return kind === ENTITY_KIND_AVATAR
    ? AVATAR_BODY_BITS
    : kind === ENTITY_KIND_VEHICLE
      ? VEHICLE_BODY_BITS
      : ROBOT_BODY_BITS;
}

/** Delta class of one axis difference (0 unchanged, 1 8-bit, 2 13-bit, 3 absolute 20-bit). */
export function deltaClass(diff: number): number {
  if (diff === 0) return 0;
  if (diff >= -128 && diff <= 127) return 1;
  if (diff >= -4096 && diff <= 4095) return 2;
  return 3;
}

/** Scratch for doubles on their way into the quantizers (see quantize.ts "Array-reading variants"). Single-threaded. */
const F = new Float64Array(24);

export class FrameWriter {
  /** The message buffer; the first `length` bytes after `finish` are the FRAME. Reused by every call. */
  readonly buffer: Uint8Array;
  private readonly maxBytes: number;
  private readonly bw: BitWriter;
  private readonly view: DataView;
  private begun = false;
  private selfDone = false;
  private flags = 0;
  private open = -1;
  private lastSection = 0;
  private lenPos = 0;
  private items = 0;
  private misuse = false;
  /** Bytes of the finished message (valid after `finish`). */
  length = 0;

  // scratch for delta computation
  private cX = 0;
  private cY = 0;
  private cZ = 0;
  private nX = 0;
  private nY = 0;
  private nZ = 0;

  constructor(maxBytes: number = FRAME_MAX_BYTES) {
    this.maxBytes = maxBytes;
    this.buffer = new Uint8Array(maxBytes);
    this.bw = new BitWriter(this.buffer);
    this.view = viewOf(this.buffer);
  }

  /** Bytes written so far (rounded up). */
  get bytesUsed(): number {
    return this.bw.byteLength;
  }

  /** Bytes still free in the message (after closing the open section's byte alignment). */
  get bytesFree(): number {
    return this.maxBytes - this.bw.byteLength;
  }

  /** Starts a frame: writes the 9-byte header (flags are patched in `finish`). */
  begin(serverTick: number, ackInputSeq: number, inputBufferDepth: number, keyframe: boolean): void {
    this.bw.reset();
    this.begun = true;
    this.selfDone = false;
    this.flags = keyframe ? 1 << FRAME_FLAG_BIT.keyframe : 0;
    this.open = -1;
    this.lastSection = 0;
    this.misuse = false;
    this.length = 0;
    this.bw.writeBits(FRAME_TYPE_ID, 8);
    this.bw.writeBits(serverTick >>> 0, 32);
    this.bw.writeBits(ackInputSeq & 0xffff, 16);
    this.bw.writeBits(inputBufferDepth > 255 ? 255 : inputBufferDepth < 0 ? 0 : inputBufferDepth, 8);
    this.bw.writeBits(0, 8);
  }

  /** Writes the Self block (always present). Returns false on misuse or overflow. */
  writeSelf(s: SelfState): boolean {
    if (!this.begun || this.selfDone) return this.fail();
    const need = s.moveState === MOVE_STATE_SEATED_DRIVER ? SELF_DRIVING_BYTES : SELF_ON_FOOT_BYTES;
    if (this.bytesFree < need) return this.fail();
    F[0] = s.px;
    F[1] = s.py;
    F[2] = s.pz;
    F[3] = s.vx;
    F[4] = s.vy;
    F[5] = s.vz;
    if (s.moveState === MOVE_STATE_SEATED_DRIVER) {
      F[6] = s.vpx;
      F[7] = s.vpy;
      F[8] = s.vpz;
      F[9] = s.lvx;
      F[10] = s.lvy;
      F[11] = s.lvz;
      F[12] = s.avx;
      F[13] = s.avy;
      F[14] = s.avz;
    }
    const bw = this.bw;
    const moveState = s.moveState < 0 ? 0 : s.moveState > MOVE_STATE_MAX ? MOVE_STATE_MAX : s.moveState;
    bw.writeBits(moveState, 5);
    bw.writeBits(clampRound(s.hopCharges, 0, 7), 3);
    bw.writeSigned(posOwnStepsAt(F, 0), QUANT.positionOwn.bits);
    bw.writeSigned(posOwnStepsAt(F, 1), QUANT.positionOwn.bits);
    bw.writeSigned(posOwnStepsAt(F, 2), QUANT.positionOwn.bits);
    bw.writeSigned(velStepsAt(F, 3), QUANT.velocityOwn.bits);
    bw.writeSigned(velStepsAt(F, 4), QUANT.velocityOwn.bits);
    bw.writeSigned(velStepsAt(F, 5), QUANT.velocityOwn.bits);
    bw.writeBits(s.yawCode & (QUANT.yaw.steps - 1), QUANT.yaw.bits);
    bw.writeBits(clampRound(s.cellGrams, 0, 0xff_ffff), 24);
    if (moveState === MOVE_STATE_SEATED_DRIVER) {
      bw.writeSigned(posOwnStepsAt(F, 6), QUANT.positionOwn.bits);
      bw.writeSigned(posOwnStepsAt(F, 7), QUANT.positionOwn.bits);
      bw.writeSigned(posOwnStepsAt(F, 8), QUANT.positionOwn.bits);
      bw.writeBits(s.orientIndex & 3, QUANT.vehicleOrientationOwn.indexBits);
      bw.writeSigned(clampRound(s.orientA, -16384, 16383), QUANT.vehicleOrientationOwn.componentBits);
      bw.writeSigned(clampRound(s.orientB, -16384, 16383), QUANT.vehicleOrientationOwn.componentBits);
      bw.writeSigned(clampRound(s.orientC, -16384, 16383), QUANT.vehicleOrientationOwn.componentBits);
      bw.writeSigned(velStepsAt(F, 9), QUANT.velocityOwn.bits);
      bw.writeSigned(velStepsAt(F, 10), QUANT.velocityOwn.bits);
      bw.writeSigned(velStepsAt(F, 11), QUANT.velocityOwn.bits);
      bw.writeSigned(velStepsAt(F, 12), QUANT.velocityOwn.bits);
      bw.writeSigned(velStepsAt(F, 13), QUANT.velocityOwn.bits);
      bw.writeSigned(velStepsAt(F, 14), QUANT.velocityOwn.bits);
      bw.writeSigned(clampRound(s.steer, -128, 127), 8);
      bw.writeBits((s.gear & 3) | (s.boost ? 4 : 0) | (s.lights ? 8 : 0), 4);
    }
    bw.align();
    this.selfDone = true;
    return !bw.overflow;
  }

  // ---- sections ---------------------------------------------------------------------------------------------------

  private fail(): boolean {
    this.misuse = true;
    return false;
  }

  /** Closes the open section: patches its length (and count) or rewinds it when empty. */
  private closeSection(): void {
    if (this.open < 0) return;
    const bw = this.bw;
    bw.align();
    const bodyStart = this.lenPos + FRAME_SECTION_LENGTH_BYTES;
    const len = bw.byteLength - bodyStart;
    if (this.items === 0) {
      bw.bitPos = this.lenPos * 8;
    } else {
      this.view.setUint16(this.lenPos, len, true);
      if (this.open === SEC_ENTITIES || this.open === SEC_STROKES) this.view.setUint8(bodyStart, this.items);
      const bit = SEC_FLAG_NAMES[this.open];
      if (bit !== null && bit !== undefined) this.flags |= 1 << bit;
    }
    this.open = -1;
  }

  /** Makes sure section `idx` is the open one. `extra` is the bytes about to be written. Returns false when it does not fit. */
  private ensure(idx: number, recordBytes: number): boolean {
    if (!this.begun || !this.selfDone) return this.fail();
    if (this.open === idx) return this.bytesFree >= recordBytes;
    if (idx <= this.lastSection) return this.fail();
    const header = FRAME_SECTION_LENGTH_BYTES + (idx === SEC_ENTITIES ? 1 : 0);
    // Close the open section first: it may still be empty, which would free its header bytes.
    this.closeSection();
    if (this.bytesFree < header + recordBytes) return false;
    this.lastSection = idx;
    this.open = idx;
    this.items = 0;
    this.lenPos = this.bw.byteLength;
    this.bw.writeBits(0, 16);
    if (idx === SEC_ENTITIES) this.bw.writeBits(0, 8);
    return true;
  }

  /** SlotChanges: assigns `slot` to `entityId` (kind ENTITY_KIND_*). The table is updated on success. */
  slotAssign(table: SlotTable, slot: number, entityId: number, kind: number): boolean {
    if (!this.ensure(SEC_SLOTS, SLOT_CHANGE_BYTES)) return false;
    this.bw.writeBits(slot, 8);
    this.bw.writeBits(SLOT_OP_ASSIGN, 1);
    this.bw.writeBits(entityId >>> 0, 32);
    this.bw.writeBits(kind & 7, 3);
    this.bw.align();
    this.items++;
    table.assign(slot, entityId >>> 0, kind);
    return true;
  }

  /** SlotChanges: releases `slot`. The table is updated on success. */
  slotRelease(table: SlotTable, slot: number): boolean {
    if (!this.ensure(SEC_SLOTS, SLOT_CHANGE_BYTES)) return false;
    this.bw.writeBits(slot, 8);
    this.bw.writeBits(SLOT_OP_RELEASE, 1);
    this.bw.writeBits(0, 32);
    this.bw.writeBits(0, 3);
    this.bw.align();
    this.items++;
    table.release(slot);
    return true;
  }

  /**
   * Entities: writes one record for `e.slot` (kind from `table`). `e.rec` is the requested type; a DELTA for a slot
   * that `needsFull` is written as FULL. Updates the table's last positions on success. Returns false (nothing
   * written, table untouched) when the record does not fit or the slot is not in the table.
   */
  writeEntity(table: SlotTable, e: EntityState): boolean {
    const slot = e.slot;
    const kind = table.kind[slot] ?? -1;
    if (kind < 0 || slot > 254) return false;
    let rec = e.rec;
    if (rec === REC_REMOVE) {
      if (!this.ensure(SEC_ENTITIES, 2) || this.items >= 255) return false;
      this.bw.writeBits(slot, 8);
      this.bw.writeBits(REC_REMOVE, 2);
      this.bw.align();
      this.items++;
      return true;
    }
    F[0] = e.px;
    F[1] = e.py;
    F[2] = e.pz;
    this.nX = posOthersStepsAt(F, 0);
    this.nY = posOthersStepsAt(F, 1);
    this.nZ = posOthersStepsAt(F, 2);
    if (table.needsFull[slot] === 1) rec = REC_FULL;
    let bits = 10 + bodyBits(kind);
    if (rec === REC_DELTA) {
      this.cX = deltaClass(this.nX - (table.stepsX[slot] ?? 0));
      this.cY = deltaClass(this.nY - (table.stepsY[slot] ?? 0));
      this.cZ = deltaClass(this.nZ - (table.stepsZ[slot] ?? 0));
      bits += 6 + (CLASS_AXIS_BITS[this.cX] ?? 0) + (CLASS_AXIS_BITS[this.cY] ?? 0) + (CLASS_AXIS_BITS[this.cZ] ?? 0);
    } else {
      bits += 3 * POS_BITS;
    }
    if (!this.ensure(SEC_ENTITIES, (bits + 7) >>> 3) || this.items >= 255) return false;
    const bw = this.bw;
    bw.writeBits(slot, 8);
    bw.writeBits(rec, 2);
    if (rec === REC_DELTA) {
      bw.writeBits(this.cX, 2);
      bw.writeBits(this.cY, 2);
      bw.writeBits(this.cZ, 2);
      this.writeDeltaAxis(this.cX, this.nX, table.stepsX[slot] ?? 0);
      this.writeDeltaAxis(this.cY, this.nY, table.stepsY[slot] ?? 0);
      this.writeDeltaAxis(this.cZ, this.nZ, table.stepsZ[slot] ?? 0);
    } else {
      bw.writeSigned(this.nX, POS_BITS);
      bw.writeSigned(this.nY, POS_BITS);
      bw.writeSigned(this.nZ, POS_BITS);
    }
    if (kind === ENTITY_KIND_AVATAR) {
      bw.writeBits(e.yawCode & (QUANT.yaw.steps - 1), QUANT.yaw.bits);
      bw.writeBits(clampRound(e.pitchCode, 0, QUANT.pitch.steps - 1), QUANT.pitch.bits);
      bw.writeBits(clampRound(e.actionState, 0, 63), 6);
      bw.writeBits(clampRound(e.toolIndex, 0, 15), 4);
      bw.writeBits(e.flags & 63, 6);
    } else if (kind === ENTITY_KIND_VEHICLE) {
      bw.writeBits(e.orientIndex & 3, 2);
      bw.writeSigned(clampRound(e.orientA, -512, 511), 10);
      bw.writeSigned(clampRound(e.orientB, -512, 511), 10);
      bw.writeSigned(clampRound(e.orientC, -512, 511), 10);
      bw.writeSigned(clampRound(e.steerCode, -32, 31), 6);
      bw.writeBits(clampRound(e.speedCode, 0, 255), 8);
      bw.writeBits(clampRound(e.driverSlot, 0, 255), 8);
      bw.writeBits(e.flags & 255, 8);
    } else if (kind === ENTITY_KIND_ROBOT) {
      bw.writeBits(e.headingCode & 255, 8);
      bw.writeBits(clampRound(e.robotState, 0, 15), 4);
      bw.writeBits(clampRound(e.cargo, 0, 7), 3);
    }
    bw.align();
    this.items++;
    table.stepsX[slot] = this.nX;
    table.stepsY[slot] = this.nY;
    table.stepsZ[slot] = this.nZ;
    if (rec === REC_FULL) table.needsFull[slot] = 0;
    return true;
  }

  private writeDeltaAxis(cls: number, steps: number, prev: number): void {
    if (cls === 0) return;
    if (cls === 3) this.bw.writeSigned(clampRound(steps, POS_OTHERS_MIN, POS_OTHERS_MAX), POS_BITS);
    else this.bw.writeSigned(steps - prev, CLASS_AXIS_BITS[cls] ?? 8);
  }

  /**
   * DustStrokes: writes chains `first ..` of `buf` while they fit (a chain is atomic), with `refTick` = this frame's
   * `serverTick` for the 8-bit tick offsets. Returns the number of chains written; the caller keeps the rest for the
   * next frame. The section's chain count is a u8.
   */
  writeStrokes(buf: StrokeChainBuffer, first: number, refTick: number): number {
    let written = 0;
    for (let i = first; i < buf.chainCount && this.items < 255; i++) {
      const bytes = strokeChainBytes(buf, i);
      // The section's first byte is the chain count (patched in closeSection).
      const extra = this.open === SEC_STROKES ? 0 : 1;
      if (!this.ensure(SEC_STROKES, bytes + extra)) break;
      if (this.items === 0) this.bw.writeBits(0, 8);
      writeStrokeChain(this.bw, buf, i, refTick);
      this.items++;
      written++;
    }
    return written;
  }

  /** RobotIntents: writes intents `first ..` while they fit. Returns the number written. */
  writeRobotIntents(list: RobotIntentList, first: number): number {
    let written = 0;
    for (let i = first; i < list.count; i++) {
      if (!this.ensure(SEC_ROBOTS, ROBOT_INTENT_BYTES)) break;
      writeRobotIntent(this.bw, list, i);
      this.items++;
      written++;
    }
    return written;
  }

  /** DustPlots: writes deltas `first ..` while they fit. Returns the number written. */
  writeDustPlots(list: DustPlotDeltaList, first: number): number {
    let written = 0;
    for (let i = first; i < list.count; i++) {
      if (!this.ensure(SEC_PLOTS, DUST_PLOT_DELTA_BYTES)) break;
      writeDustPlotDelta(this.bw, list, i);
      this.items++;
      written++;
    }
    return written;
  }

  /** Closes the frame: patches the flags byte. Returns the message length (0 after misuse or overflow). */
  finish(): number {
    if (!this.begun) return 0;
    this.closeSection();
    this.begun = false;
    if (this.misuse || this.bw.overflow || !this.selfDone) {
      this.length = 0;
      return 0;
    }
    this.view.setUint8(FRAME_HEADER_BYTES - 1, this.flags);
    this.length = this.bw.byteLength;
    return this.length;
  }
}
