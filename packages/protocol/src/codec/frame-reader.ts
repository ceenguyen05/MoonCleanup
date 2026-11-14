// FRAME decoder (server -> client). Layout: see frame-writer.ts and protocol/frame.ts in @moon-cleanup/shared.
//
// `FrameReader.decode` fills a pooled `FrameView` and updates the client's `SlotTable` in place (slot changes are
// applied as they are read; delta positions are resolved against the table's last known positions). It never throws and
// never allocates: all capacities are fixed (frame-state.ts), every count read from the wire is checked against both a
// capacity and the bits that remain BEFORE any loop runs.
//
// Strictness (BIT_PACKING): the message type must be FRAME, flag bit 7 zero, section order and `u16` lengths exact (a
// section must be consumed to its last byte), record padding bits zero, enum codes in range, no trailing bytes. A frame
// that fails mid-way may already have applied some slot changes; the caller treats any non-zero result as
// "request a keyframe" (the session layer does this) rather than trying to repair the table.
//
// An events section (v1.0 only; the MVP server never sets it) is skipped by its length prefix and reported in
// `FrameView.skippedEventsBytes`.

import { FRAME_FLAG_BIT, FRAME_HEADER_BYTES, FRAME_MAX_BYTES, FRAME_TYPE_ID, QUANT } from "@moon-cleanup/shared";
import { BitReader } from "./bits";
import { readDustPlotDelta, readRobotIntent, readStrokeChain } from "./dust-wire";
import {
  AVATAR_ACTION_STATE_MAX,
  ENTITY_KIND_AVATAR,
  ENTITY_KIND_ROBOT,
  ENTITY_KIND_VEHICLE,
  FRAME_MAX_ENTITY_RECORDS,
  FRAME_MAX_SLOT_CHANGES,
  GEAR_MAX,
  MOVE_STATE_MAX,
  MOVE_STATE_SEATED_DRIVER,
  REC_FULL,
  REC_REMOVE,
  ROBOT_STATE_MAX,
  SLOT_OP_ASSIGN,
  SLOT_OP_RELEASE,
  type EntityState,
  type FrameView,
  type SelfState,
  type SlotTable,
} from "./frame-state";
import { POS_OTHERS_RES, POS_OWN_RES, VEL_RES } from "./quantize";

export const FRAME_OK = 0;
export const FRAME_ERR_TRUNCATED = 1;
export const FRAME_ERR_TYPE = 2;
export const FRAME_ERR_FLAGS = 3;
export const FRAME_ERR_SECTION = 4;
export const FRAME_ERR_VALUE = 5;
export const FRAME_ERR_PADDING = 6;
export const FRAME_ERR_CAPACITY = 7;
export const FRAME_ERR_SLOT = 8;
export const FRAME_ERR_TRAILING = 9;
export const FRAME_ERR_MESSAGES = [
  "ok",
  "truncated",
  "wrong message type",
  "reserved flag bit set",
  "bad section framing",
  "field value out of range",
  "non-zero padding",
  "capacity exceeded",
  "entity record for an unknown slot",
  "trailing bytes",
] as const;

const POS_BITS = QUANT.positionOthers.bits;
const CLASS_AXIS_BITS = QUANT.positionDelta.classAxisBits;

/** Flag bit of each section after Self, indexed by section number 1..6 (in wire order). */
const SECTION_FLAG_BITS = [
  0,
  FRAME_FLAG_BIT.hasSlotChanges,
  FRAME_FLAG_BIT.hasEntities,
  FRAME_FLAG_BIT.hasStrokes,
  FRAME_FLAG_BIT.hasRobotIntents,
  FRAME_FLAG_BIT.hasDustPlots,
  FRAME_FLAG_BIT.hasEvents,
] as const;

export class FrameReader {
  private readonly br = new BitReader();

  /**
   * Decodes `message` (whole FRAME including the type byte) into `out`. `plotCount` bounds plot ids in the dust
   * sections. Returns FRAME_OK or a FRAME_ERR_* code; `out` is only meaningful on FRAME_OK.
   */
  decode(message: Uint8Array, out: FrameView, table: SlotTable, plotCount: number): number {
    out.reset();
    const len = message.byteLength;
    if (len < FRAME_HEADER_BYTES) return FRAME_ERR_TRUNCATED;
    if (len > FRAME_MAX_BYTES) return FRAME_ERR_CAPACITY;
    const br = this.br;
    br.reset(message);
    if (br.readBits(8) !== FRAME_TYPE_ID) return FRAME_ERR_TYPE;
    out.serverTick = br.readBits(32);
    out.ackInputSeq = br.readBits(16);
    out.inputBufferDepth = br.readBits(8);
    const flags = br.readBits(8);
    out.flags = flags;
    if ((flags & 0x80) !== 0) return FRAME_ERR_FLAGS;
    out.keyframe = (flags & (1 << FRAME_FLAG_BIT.keyframe)) !== 0;

    let err = this.readSelf(br, out.self);
    if (err !== FRAME_OK) return err;

    for (let section = 1; section <= 6; section++) {
      const bit = SECTION_FLAG_BITS[section] ?? 0;
      if ((flags & (1 << bit)) === 0) continue;
      if (br.bitPos & 7) return FRAME_ERR_SECTION;
      const at = br.bitPos >>> 3;
      if (at + 2 > len) return FRAME_ERR_TRUNCATED;
      const sectionLen = (message[at] ?? 0) | ((message[at + 1] ?? 0) << 8);
      const end = at + 2 + sectionLen;
      if (sectionLen === 0) return FRAME_ERR_SECTION;
      if (end > len) return FRAME_ERR_TRUNCATED;
      br.bitPos = (at + 2) * 8;
      switch (section) {
        case 1:
          err = this.readSlotChanges(br, out, table, end);
          out.hasSlotChanges = true;
          break;
        case 2:
          err = this.readEntities(br, out, table, end);
          out.hasEntities = true;
          break;
        case 3:
          err = this.readStrokes(br, out, plotCount, end);
          out.hasStrokes = true;
          break;
        case 4:
          err = this.readRobots(br, out, plotCount, end);
          out.hasRobotIntents = true;
          break;
        case 5:
          err = this.readPlots(br, out, plotCount, end);
          out.hasDustPlots = true;
          break;
        default:
          out.skippedEventsBytes = sectionLen;
          out.hasEvents = true;
          br.bitPos = end * 8;
          err = FRAME_OK;
          break;
      }
      if (err !== FRAME_OK) return err;
      if (br.error) return FRAME_ERR_TRUNCATED;
      if (br.bitPos !== end * 8) return FRAME_ERR_SECTION;
    }
    if (br.bitPos !== len * 8) return FRAME_ERR_TRAILING;
    return FRAME_OK;
  }

  private readSelf(br: BitReader, s: SelfState): number {
    const moveState = br.readBits(5);
    s.moveState = moveState;
    s.hopCharges = br.readBits(3);
    s.px = br.readSigned(QUANT.positionOwn.bits) * POS_OWN_RES;
    s.py = br.readSigned(QUANT.positionOwn.bits) * POS_OWN_RES;
    s.pz = br.readSigned(QUANT.positionOwn.bits) * POS_OWN_RES;
    s.vx = br.readSigned(QUANT.velocityOwn.bits) * VEL_RES;
    s.vy = br.readSigned(QUANT.velocityOwn.bits) * VEL_RES;
    s.vz = br.readSigned(QUANT.velocityOwn.bits) * VEL_RES;
    s.yawCode = br.readBits(QUANT.yaw.bits);
    s.cellGrams = br.readBits(24);
    if (moveState === MOVE_STATE_SEATED_DRIVER) {
      s.vpx = br.readSigned(QUANT.positionOwn.bits) * POS_OWN_RES;
      s.vpy = br.readSigned(QUANT.positionOwn.bits) * POS_OWN_RES;
      s.vpz = br.readSigned(QUANT.positionOwn.bits) * POS_OWN_RES;
      s.orientIndex = br.readBits(QUANT.vehicleOrientationOwn.indexBits);
      s.orientA = br.readSigned(QUANT.vehicleOrientationOwn.componentBits);
      s.orientB = br.readSigned(QUANT.vehicleOrientationOwn.componentBits);
      s.orientC = br.readSigned(QUANT.vehicleOrientationOwn.componentBits);
      s.lvx = br.readSigned(QUANT.velocityOwn.bits) * VEL_RES;
      s.lvy = br.readSigned(QUANT.velocityOwn.bits) * VEL_RES;
      s.lvz = br.readSigned(QUANT.velocityOwn.bits) * VEL_RES;
      s.avx = br.readSigned(QUANT.velocityOwn.bits) * VEL_RES;
      s.avy = br.readSigned(QUANT.velocityOwn.bits) * VEL_RES;
      s.avz = br.readSigned(QUANT.velocityOwn.bits) * VEL_RES;
      s.steer = br.readSigned(8);
      const g = br.readBits(4);
      s.gear = g & 3;
      s.boost = (g & 4) !== 0;
      s.lights = (g & 8) !== 0;
    }
    if (br.error) return FRAME_ERR_TRUNCATED;
    if (moveState > MOVE_STATE_MAX || s.gear > GEAR_MAX) return FRAME_ERR_VALUE;
    return this.padOk(br) ? FRAME_OK : FRAME_ERR_PADDING;
  }

  /** Consumes the padding of the current record and reports whether it was all zero. */
  private padOk(br: BitReader): boolean {
    const pad = (8 - (br.bitPos & 7)) & 7;
    return pad === 0 || br.readBits(pad) === 0;
  }

  private readSlotChanges(br: BitReader, out: FrameView, table: SlotTable, end: number): number {
    const list = out.slotChanges;
    const bytes = end * 8 - br.bitPos;
    if (bytes % 48 !== 0) return FRAME_ERR_SECTION;
    const count = bytes / 48;
    if (count > FRAME_MAX_SLOT_CHANGES) return FRAME_ERR_CAPACITY;
    for (let i = 0; i < count; i++) {
      const slot = br.readBits(8);
      const op = br.readBits(1);
      const entityId = br.readBits(32);
      const kind = br.readBits(3);
      if (br.error) return FRAME_ERR_TRUNCATED;
      if (!this.padOk(br)) return FRAME_ERR_PADDING;
      if (slot > 254) return FRAME_ERR_VALUE;
      if (op === SLOT_OP_ASSIGN) {
        if (kind > ENTITY_KIND_ROBOT) return FRAME_ERR_VALUE;
        table.assign(slot, entityId, kind);
      } else {
        if (kind !== 0 || entityId !== 0) return FRAME_ERR_VALUE;
        table.release(slot);
      }
      list.slot[i] = slot;
      list.op[i] = op === SLOT_OP_ASSIGN ? SLOT_OP_ASSIGN : SLOT_OP_RELEASE;
      list.entityId[i] = entityId;
      list.kind[i] = kind;
    }
    list.count = count;
    return FRAME_OK;
  }

  private readEntities(br: BitReader, out: FrameView, table: SlotTable, end: number): number {
    const count = br.readBits(8);
    if (count > FRAME_MAX_ENTITY_RECORDS) return FRAME_ERR_CAPACITY;
    // Every record is at least 2 bytes (slot + recType, remove): a count the section cannot hold is corrupt.
    if (count * 2 > end - (br.bitPos >>> 3)) return FRAME_ERR_SECTION;
    for (let i = 0; i < count; i++) {
      const e = out.entities[i];
      if (e === undefined) return FRAME_ERR_CAPACITY;
      const slot = br.readBits(8);
      const rec = br.readBits(2);
      if (br.error) return FRAME_ERR_TRUNCATED;
      if (slot > 254 || rec > REC_REMOVE) return FRAME_ERR_VALUE;
      e.slot = slot;
      e.rec = rec;
      if (rec === REC_REMOVE) {
        e.kind = table.kind[slot] ?? -1;
        if (!this.padOk(br)) return FRAME_ERR_PADDING;
        continue;
      }
      const kind = table.kind[slot] ?? -1;
      if (kind < 0) return FRAME_ERR_SLOT;
      e.kind = kind;
      if (rec === REC_FULL) {
        const x = br.readSigned(POS_BITS);
        const y = br.readSigned(POS_BITS);
        const z = br.readSigned(POS_BITS);
        table.stepsX[slot] = x;
        table.stepsY[slot] = y;
        table.stepsZ[slot] = z;
        e.dClsX = e.dClsY = e.dClsZ = 0;
        e.dStepsX = e.dStepsY = e.dStepsZ = 0;
      } else {
        const cx = br.readBits(2);
        const cy = br.readBits(2);
        const cz = br.readBits(2);
        e.dClsX = cx;
        e.dClsY = cy;
        e.dClsZ = cz;
        e.dStepsX = this.readDeltaAxis(br, cx, table.stepsX, slot);
        e.dStepsY = this.readDeltaAxis(br, cy, table.stepsY, slot);
        e.dStepsZ = this.readDeltaAxis(br, cz, table.stepsZ, slot);
      }
      e.px = (table.stepsX[slot] ?? 0) * POS_OTHERS_RES;
      e.py = (table.stepsY[slot] ?? 0) * POS_OTHERS_RES;
      e.pz = (table.stepsZ[slot] ?? 0) * POS_OTHERS_RES;
      const err = this.readBody(br, e, kind);
      if (err !== FRAME_OK) return err;
      if (br.error) return FRAME_ERR_TRUNCATED;
      if (!this.padOk(br)) return FRAME_ERR_PADDING;
    }
    out.entityCount = count;
    return FRAME_OK;
  }

  /** Reads one delta axis and applies it to `steps[slot]`; returns the wire steps (relative, or absolute for class 3). */
  private readDeltaAxis(br: BitReader, cls: number, steps: Int32Array, slot: number): number {
    if (cls === 0) return 0;
    const v = br.readSigned(CLASS_AXIS_BITS[cls] ?? 8);
    steps[slot] = cls === 3 ? v : (steps[slot] ?? 0) + v;
    return v;
  }

  private readBody(br: BitReader, e: EntityState, kind: number): number {
    if (kind === ENTITY_KIND_AVATAR) {
      e.yawCode = br.readBits(QUANT.yaw.bits);
      e.pitchCode = br.readBits(QUANT.pitch.bits);
      e.actionState = br.readBits(6);
      e.toolIndex = br.readBits(4);
      e.flags = br.readBits(6);
      if (e.actionState > AVATAR_ACTION_STATE_MAX) return FRAME_ERR_VALUE;
    } else if (kind === ENTITY_KIND_VEHICLE) {
      e.orientIndex = br.readBits(2);
      e.orientA = br.readSigned(10);
      e.orientB = br.readSigned(10);
      e.orientC = br.readSigned(10);
      e.steerCode = br.readSigned(6);
      e.speedCode = br.readBits(8);
      e.driverSlot = br.readBits(8);
      e.flags = br.readBits(8);
    } else if (kind === ENTITY_KIND_ROBOT) {
      e.headingCode = br.readBits(8);
      e.robotState = br.readBits(4);
      e.cargo = br.readBits(3);
      if (e.robotState > ROBOT_STATE_MAX) return FRAME_ERR_VALUE;
    } else {
      return FRAME_ERR_VALUE;
    }
    return FRAME_OK;
  }

  private readStrokes(br: BitReader, out: FrameView, plotCount: number, end: number): number {
    const count = br.readBits(8);
    if (count * 18 > end - (br.bitPos >>> 3)) return FRAME_ERR_SECTION;
    for (let i = 0; i < count; i++) {
      if (!readStrokeChain(br, out.strokes, out.serverTick, plotCount)) {
        return br.error
          ? FRAME_ERR_TRUNCATED
          : out.strokes.chainCount >= out.strokes.maxChains
            ? FRAME_ERR_CAPACITY
            : FRAME_ERR_VALUE;
      }
    }
    return FRAME_OK;
  }

  private readRobots(br: BitReader, out: FrameView, plotCount: number, end: number): number {
    const bytes = end - (br.bitPos >>> 3);
    if (bytes % 20 !== 0) return FRAME_ERR_SECTION;
    for (let i = bytes / 20; i > 0; i--) {
      if (!readRobotIntent(br, out.robotIntents, plotCount)) return br.error ? FRAME_ERR_TRUNCATED : FRAME_ERR_VALUE;
    }
    return FRAME_OK;
  }

  private readPlots(br: BitReader, out: FrameView, plotCount: number, end: number): number {
    const bytes = end - (br.bitPos >>> 3);
    if (bytes % 4 !== 0) return FRAME_ERR_SECTION;
    for (let i = bytes / 4; i > 0; i--) {
      if (!readDustPlotDelta(br, out.dustPlots, plotCount)) return br.error ? FRAME_ERR_TRUNCATED : FRAME_ERR_VALUE;
    }
    return FRAME_OK;
  }
}
