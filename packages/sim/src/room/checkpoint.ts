// Sim checkpoint codec: the bodies of the two save-envelope sections packages/sim owns (save/format v1: META = 1,
// PLAYERS = 2). `MoonRoomSim.captureCheckpoint()` writes them, `MoonRoomSim.restoreCheckpoint()` reads them back; the
// host owns the envelope (magic, header, CRC, gzip) and stores each body with the section version exported here.
//
// The bytes are NEVER trusted: every length, index, flag and number is checked before the sim is touched, and a
// rejected checkpoint leaves the sim exactly as it was (decode -> validate -> commit). Two kinds of check:
//   - structural (sizes, versions, unknown flag bits, non-finite numbers, indices outside a table, impossible
//     ownership): the checkpoint is rejected with a code;
//   - tunable bounds that a balance edit may shrink between builds (tick timers, Dust Cell grams above capacity,
//     suit-gear levels): the value is clamped and counted, so a tuning change never destroys a save.
// Nothing here runs on the tick path (capture and restore are host calls between ticks); allocation is allowed.
//
// The whole per-actor state is stored, including the transient tool-head and input-edge state, so a restored sim
// continues bit for bit like the one that was saved. Derived values are not stored: Hop Pack charges cap and Dust
// Cell levels are recomputed from the restored suit gear. The dust ledger is not part of these sections (it sits
// behind DustLedgerPort and is saved as dust chunks by its owner).
//
// All integers little-endian, reals as IEEE f64 (exact round trip of the 2^-16 quantised state).
//
// META v1
//   u16 tickHz                 must equal the running config (timers are in ticks)
//   u8  toolCount              must equal the tool table size
//   u8  dayPhase               index into DAY_PHASES (last phase announced by daynight.changed)
//   u32 toolTableHash          FNV-1a 32 of the tool ids in table order (guards a reordered / edited table)
//   u32 tickLo, u32 tickHi     next tick to run (tickHi < 2^21)
//   f64 walletLm
//   u32 standardIssueOwned     bitmask by tool code
//   toolCount x i32 copiesBought
//   u8  gearCount, then per entry: u8 keyBytes, key (printable ASCII), u8 level
//
// PLAYERS v1
//   u8 count, u8 toolCount, then `count` records of simCheckpointPlayerRecordBytes(toolCount) bytes, ascending slot:
//   u8  slot
//   u8  avatarFlags            bit0 jumped, bit1 jumpCutUsed, bit2 touchdown, bit3 yawFrame
//   u8  moveState, u8 lastLanding
//   13 x f64                   px py pz vx vy vz fx fy fz heightAboveGround airSpeedCap lastImpactMps recoverAccelMult
//   9 x u32                    coyote, jumpBuffer, snapOff, hopCharges, hopRecharge, hopInterval, recover, moveLock,
//                              jumpLock
//   u32 plotHint
//   u8  toolCode, u8 holsterSlot
//   u16 toolFlags              bit0 sweeping, 1 detailing, 2 wasActive, 3 laneLocked, 4 headValid, 5 inContact,
//                              6 speedLifted, 7 anchorValid, 8 lastContactValid, 9 nearFullLatched, 10 fullLatched
//   u32 swapTicks, u32 owned
//   u16 seqAtToolDown, u16 mgAccum
//   i32 detailCooldownMs, u32 rejectedFull
//   11 x f64                   aim01 laneAngle head(xyz) anchor(xyz) last(xyz)
//   toolCount x i32 cellGrams
//   u16 seq, u16 yaw, u16 buttons, u16 prevButtons
//   i8  moveX, i8 moveY, i8 pitch, u8 toolParam
//   u8  actorFlags             bit0 lamp on
//
// Changing either layout bumps that section's version (format.ts: section versions belong to the writing package).
// Version 0 of both sections is the sim-host interim layout; this codec does not read it.

import { DAY_PHASES, HOLSTER_SLOT_COUNT, INPUT_AXIS_MAX, MAX_PLAYERS_PER_ROOM } from "@moon-cleanup/shared";
import type { SimConfig } from "../config/sim-config";
import { FNV_OFFSET, FNV_PRIME } from "../math/quantize";
import { AvatarState, LAND_FACEPLANT, MOVE_HOPPING } from "../movement/avatar";
import { cellCapGrams, ToolState } from "../tools/tool";

/** Section version of the META body written by this codec. */
export const SIM_CHECKPOINT_META_VERSION = 1;
/** Section version of the PLAYERS body written by this codec. */
export const SIM_CHECKPOINT_PLAYERS_VERSION = 1;
/** Hard size limits of the two bodies; anything longer is rejected before a single byte is parsed. */
export const SIM_CHECKPOINT_META_MAX_BYTES = 8192;
export const SIM_CHECKPOINT_PLAYERS_MAX_BYTES = 8192;
/** Tool ownership is a 32-bit mask by tool code; the codec supports tables of up to 31 tools. */
export const SIM_CHECKPOINT_MAX_TOOLS = 31;
/** Suit-gear entries and key length accepted in META. */
export const SIM_CHECKPOINT_MAX_GEAR = 64;
export const SIM_CHECKPOINT_MAX_GEAR_KEY_BYTES = 64;

/** The two section bodies of one sim checkpoint, with their section versions. */
export interface SimCheckpoint {
  readonly metaVersion: number;
  readonly meta: Uint8Array;
  readonly playersVersion: number;
  readonly players: Uint8Array;
  /**
   * PUCKS section body (cargo/checkpoint.ts, SIM_CHECKPOINT_PUCKS_VERSION). Optional: checkpoints written before
   * M1-W6-T01 have none and restore with no pucks.
   */
  readonly pucksVersion?: number;
  readonly pucks?: Uint8Array;
}

/** Why a checkpoint was rejected. */
export type SimRestoreRejectCode =
  /** A section version this build does not read (including the interim version 0). */
  | "unsupported_version"
  /** A body is longer than its hard limit. */
  | "oversize"
  /** Wrong shape: not bytes, truncated, trailing bytes, unknown flag bits, bad counts or keys. */
  | "malformed"
  /** Written for another tick rate or tool table. */
  | "config_mismatch"
  /** A number or index outside what the sim can ever hold. */
  | "out_of_range";

/** Outcome of `MoonRoomSim.restoreCheckpoint`. A rejected restore changes nothing. */
export interface SimRestoreResult {
  readonly ok: boolean;
  readonly code: "ok" | SimRestoreRejectCode;
  /** Name of the offending field (never echoes input bytes); empty when ok. */
  readonly detail: string;
  /** Next tick of the sim after the call (the restored tick when ok, the unchanged tick otherwise). */
  readonly tick: number;
  /** Actors whose state was replaced. */
  readonly restoredActors: number;
  /** Records whose slot has no joined actor (ignored). */
  readonly skippedRecords: number;
  /** Tunable-bound values that were clamped (timers, Cell grams above capacity, gear levels). */
  readonly clampedValues: number;
  /** Suit-gear keys this build does not know (ignored). */
  readonly ignoredGearKeys: number;
}

/** A rejection found while decoding or validating. */
export class CheckpointFail {
  constructor(
    readonly code: SimRestoreRejectCode,
    readonly detail: string,
  ) {}
}

/** Counters filled during validation. */
export class CheckpointTally {
  clamped = 0;
  ignoredGear = 0;
}

/** The input fields of one actor that the sim keeps between ticks (the room's ActorInput). */
export interface CheckpointInputState {
  seq: number;
  moveX: number;
  moveY: number;
  yaw: number;
  pitch: number;
  buttons: number;
  toolParam: number;
  prevButtons: number;
}

const AVATAR_FLAG_JUMPED = 1;
const AVATAR_FLAG_JUMP_CUT_USED = 2;
const AVATAR_FLAG_TOUCHDOWN = 4;
const AVATAR_FLAG_YAW_FRAME = 8;
const AVATAR_FLAGS_KNOWN = 15;

const TOOL_FLAG_SWEEPING = 1;
const TOOL_FLAG_DETAILING = 2;
const TOOL_FLAG_WAS_ACTIVE = 4;
const TOOL_FLAG_LANE_LOCKED = 8;
const TOOL_FLAG_HEAD_VALID = 16;
const TOOL_FLAG_IN_CONTACT = 32;
const TOOL_FLAG_SPEED_LIFTED = 64;
const TOOL_FLAG_ANCHOR_VALID = 128;
const TOOL_FLAG_LAST_CONTACT_VALID = 256;
const TOOL_FLAG_NEAR_FULL = 512;
const TOOL_FLAG_FULL = 1024;
const TOOL_FLAGS_KNOWN = 2047;

const ACTOR_FLAG_LAMP = 1;
const ACTOR_FLAGS_KNOWN = 1;

const META_FIXED_BYTES = 2 + 1 + 1 + 4 + 8 + 8 + 4;
const PLAYER_FIXED_BYTES = 4 + 13 * 8 + 9 * 4 + 4 + 2 + 2 + 8 + 4 + 8 + 11 * 8 + 8 + 4 + 1;
const TICK_HI_LIMIT = 0x200000; // tick < 2^53
const TWO_PI = 6.283185307179586;
const MG_PER_GRAM = 1000;

/** Bytes of one PLAYERS record for a tool table of `toolCount` tools. */
export function simCheckpointPlayerRecordBytes(toolCount: number): number {
  return PLAYER_FIXED_BYTES + 4 * toolCount;
}

/** FNV-1a 32 over the tool ids in table order (each id followed by a 0 byte). */
export function toolTableHash(cfg: SimConfig): number {
  let h = FNV_OFFSET;
  for (const t of cfg.tools) {
    for (let k = 0; k < t.id.length; k++) h = Math.imul(h ^ (t.id.charCodeAt(k) & 0xff), FNV_PRIME);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

// ---- Byte cursor ----------------------------------------------------------------------------------------------------

/** Fixed-size little-endian writer (capture only; the size is computed up front). */
export class CheckpointWriter {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private at = 0;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  u8(v: number): void {
    this.view.setUint8(this.at, v);
    this.at += 1;
  }

  i8(v: number): void {
    this.view.setInt8(this.at, v);
    this.at += 1;
  }

  u16(v: number): void {
    this.view.setUint16(this.at, v, true);
    this.at += 2;
  }

  u32(v: number): void {
    this.view.setUint32(this.at, v, true);
    this.at += 4;
  }

  i32(v: number): void {
    this.view.setInt32(this.at, v, true);
    this.at += 4;
  }

  f64(v: number): void {
    this.view.setFloat64(this.at, v, true);
    this.at += 8;
  }

  /** The finished body; throws if the writer did not fill exactly the size it was created with. */
  finish(): Uint8Array {
    if (this.at !== this.bytes.length) throw new RangeError(`checkpoint body ${this.at} of ${this.bytes.length} bytes`);
    return this.bytes;
  }
}

/** Bounds-checked little-endian reader: reading past the end returns 0 and latches `failed` (never throws). */
export class CheckpointReader {
  private readonly view: DataView;
  private at = 0;
  private bad = false;

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private take(n: number): number {
    const at = this.at;
    if (this.bad || at + n > this.view.byteLength) {
      this.bad = true;
      return -1;
    }
    this.at = at + n;
    return at;
  }

  u8(): number {
    const at = this.take(1);
    return at < 0 ? 0 : this.view.getUint8(at);
  }

  i8(): number {
    const at = this.take(1);
    return at < 0 ? 0 : this.view.getInt8(at);
  }

  u16(): number {
    const at = this.take(2);
    return at < 0 ? 0 : this.view.getUint16(at, true);
  }

  u32(): number {
    const at = this.take(4);
    return at < 0 ? 0 : this.view.getUint32(at, true);
  }

  i32(): number {
    const at = this.take(4);
    return at < 0 ? 0 : this.view.getInt32(at, true);
  }

  f64(): number {
    const at = this.take(8);
    return at < 0 ? 0 : this.view.getFloat64(at, true);
  }

  get failed(): boolean {
    return this.bad;
  }

  /** True when every byte was consumed and no read overran. */
  get done(): boolean {
    return !this.bad && this.at === this.view.byteLength;
  }
}

// ---- META -----------------------------------------------------------------------------------------------------------

/** Decoded META body (not yet validated against the config). */
export interface CheckpointMeta {
  tickHz: number;
  toolCount: number;
  dayPhase: number;
  toolTableHash: number;
  tick: number;
  walletLm: number;
  standardIssueOwned: number;
  copiesBought: Int32Array;
  gearKeys: string[];
  gearLevels: number[];
}

/** What the room hands to `encodeCheckpointMeta`. */
export interface CheckpointMetaSource {
  readonly tick: number;
  readonly dayPhase: number;
  readonly walletLm: number;
  readonly standardIssueOwned: number;
  readonly copiesBought: Int32Array;
  readonly suitGear: Readonly<Record<string, number>>;
}

function isGearKey(key: string): boolean {
  if (key.length < 1 || key.length > SIM_CHECKPOINT_MAX_GEAR_KEY_BYTES) return false;
  for (let k = 0; k < key.length; k++) {
    const c = key.charCodeAt(k);
    if (c < 0x21 || c > 0x7e) return false;
  }
  return true;
}

/** Writes the META body. Suit-gear entries are written in sorted key order (canonical bytes). */
export function encodeCheckpointMeta(cfg: SimConfig, src: CheckpointMetaSource): Uint8Array {
  const toolCount = cfg.tools.length;
  if (toolCount > SIM_CHECKPOINT_MAX_TOOLS)
    throw new RangeError(`checkpoint supports ${SIM_CHECKPOINT_MAX_TOOLS} tools`);
  const keys: string[] = [];
  for (const key of Object.keys(src.suitGear).sort()) {
    const level = src.suitGear[key];
    if (!isGearKey(key) || level === undefined || !Number.isInteger(level) || level < 0 || level > 255) continue;
    if (keys.length < SIM_CHECKPOINT_MAX_GEAR) keys.push(key);
  }
  let size = META_FIXED_BYTES + 4 * toolCount + 1;
  for (const key of keys) size += 1 + key.length + 1;
  const w = new CheckpointWriter(size);
  w.u16(cfg.tickHz);
  w.u8(toolCount);
  w.u8(src.dayPhase);
  w.u32(toolTableHash(cfg));
  const tickHi = Math.floor(src.tick / 4294967296);
  w.u32(src.tick - tickHi * 4294967296);
  w.u32(tickHi);
  w.f64(src.walletLm);
  w.u32(src.standardIssueOwned >>> 0);
  for (let k = 0; k < toolCount; k++) w.i32(src.copiesBought[k] ?? 0);
  w.u8(keys.length);
  for (const key of keys) {
    w.u8(key.length);
    for (let k = 0; k < key.length; k++) w.u8(key.charCodeAt(k));
    w.u8(src.suitGear[key] ?? 0);
  }
  return w.finish();
}

/** Parses a META body (shape only; `validateCheckpointMeta` checks the values). */
export function decodeCheckpointMeta(bytes: Uint8Array): CheckpointMeta | CheckpointFail {
  const r = new CheckpointReader(bytes);
  const tickHz = r.u16();
  const toolCount = r.u8();
  const dayPhase = r.u8();
  const hash = r.u32();
  const tickLo = r.u32();
  const tickHi = r.u32();
  const walletLm = r.f64();
  const standardIssueOwned = r.u32();
  if (r.failed) return new CheckpointFail("malformed", "meta.length");
  if (toolCount > SIM_CHECKPOINT_MAX_TOOLS) return new CheckpointFail("malformed", "meta.toolCount");
  if (tickHi >= TICK_HI_LIMIT) return new CheckpointFail("out_of_range", "meta.tick");
  const copiesBought = new Int32Array(toolCount);
  for (let k = 0; k < toolCount; k++) copiesBought[k] = r.i32();
  const gearCount = r.u8();
  if (r.failed) return new CheckpointFail("malformed", "meta.length");
  if (gearCount > SIM_CHECKPOINT_MAX_GEAR) return new CheckpointFail("malformed", "meta.gearCount");
  const gearKeys: string[] = [];
  const gearLevels: number[] = [];
  for (let g = 0; g < gearCount; g++) {
    const n = r.u8();
    if (r.failed || n < 1 || n > SIM_CHECKPOINT_MAX_GEAR_KEY_BYTES)
      return new CheckpointFail("malformed", "meta.gearKey");
    let key = "";
    for (let k = 0; k < n; k++) {
      const c = r.u8();
      if (c < 0x21 || c > 0x7e) return new CheckpointFail("malformed", "meta.gearKey");
      key += String.fromCharCode(c);
    }
    const level = r.u8();
    if (r.failed) return new CheckpointFail("malformed", "meta.length");
    if (gearKeys.includes(key)) return new CheckpointFail("malformed", "meta.gearKey");
    gearKeys.push(key);
    gearLevels.push(level);
  }
  if (!r.done) return new CheckpointFail("malformed", "meta.length");
  return {
    tickHz,
    toolCount,
    dayPhase,
    toolTableHash: hash,
    tick: tickHi * 4294967296 + tickLo,
    walletLm,
    standardIssueOwned: standardIssueOwned | 0,
    copiesBought,
    gearKeys,
    gearLevels,
  };
}

/**
 * Checks a decoded META against the running config and resolves its suit gear into `gearOut` (known keys only,
 * levels clamped to the line's top level). Returns the rejection, or null.
 */
export function validateCheckpointMeta(
  meta: CheckpointMeta,
  cfg: SimConfig,
  gearMaxLevel: ReadonlyMap<string, number>,
  gearOut: Record<string, number>,
  tally: CheckpointTally,
): CheckpointFail | null {
  if (meta.tickHz !== cfg.tickHz) return new CheckpointFail("config_mismatch", "meta.tickHz");
  if (meta.toolCount !== cfg.tools.length) return new CheckpointFail("config_mismatch", "meta.toolCount");
  if (meta.toolTableHash !== toolTableHash(cfg)) return new CheckpointFail("config_mismatch", "meta.toolTableHash");
  if (meta.dayPhase >= DAY_PHASES.length) return new CheckpointFail("out_of_range", "meta.dayPhase");
  if (!Number.isSafeInteger(meta.tick) || meta.tick < 0) return new CheckpointFail("out_of_range", "meta.tick");
  if (!(meta.walletLm >= 0 && meta.walletLm <= Number.MAX_SAFE_INTEGER)) {
    return new CheckpointFail("out_of_range", "meta.walletLm");
  }
  // Standard Issue is a property of cleaning tools only.
  let cleaning = 0;
  for (const t of cfg.tools) if (t.cleans) cleaning |= 1 << t.code;
  if ((meta.standardIssueOwned & ~cleaning) !== 0) return new CheckpointFail("out_of_range", "meta.standardIssueOwned");
  for (let k = 0; k < meta.copiesBought.length; k++) {
    if (meta.copiesBought[k]! < 0) return new CheckpointFail("out_of_range", "meta.copiesBought");
  }
  for (let g = 0; g < meta.gearKeys.length; g++) {
    const key = meta.gearKeys[g]!;
    const max = gearMaxLevel.get(key);
    if (max === undefined) {
      tally.ignoredGear++;
      continue;
    }
    let level = meta.gearLevels[g]!;
    if (level > max) {
      level = max;
      tally.clamped++;
    }
    gearOut[key] = level;
  }
  return null;
}

// ---- PLAYERS --------------------------------------------------------------------------------------------------------

/** One decoded PLAYERS record: full avatar, tool and input state of a slot. */
export class CheckpointPlayer implements CheckpointInputState {
  slot = 0;
  readonly avatar = new AvatarState();
  readonly tool: ToolState;
  avatarFlags = 0;
  toolFlags = 0;
  actorFlags = 0;
  seq = 0;
  moveX = 0;
  moveY = 0;
  yaw = 0;
  pitch = 0;
  buttons = 0;
  toolParam = 0;
  prevButtons = 0;
  lampOn = false;

  constructor(toolCount: number) {
    this.tool = new ToolState(toolCount);
  }
}

/** Appends one PLAYERS record. */
export function writeCheckpointPlayer(
  w: CheckpointWriter,
  slot: number,
  a: Readonly<AvatarState>,
  t: Readonly<ToolState>,
  input: Readonly<CheckpointInputState>,
  lampOn: boolean,
): void {
  w.u8(slot);
  w.u8(
    (a.jumped ? AVATAR_FLAG_JUMPED : 0) |
      (a.jumpCutUsed ? AVATAR_FLAG_JUMP_CUT_USED : 0) |
      (a.touchdown ? AVATAR_FLAG_TOUCHDOWN : 0) |
      (a.yawFrame !== 0 ? AVATAR_FLAG_YAW_FRAME : 0),
  );
  w.u8(a.moveState);
  w.u8(a.lastLanding);
  w.f64(a.px);
  w.f64(a.py);
  w.f64(a.pz);
  w.f64(a.vx);
  w.f64(a.vy);
  w.f64(a.vz);
  w.f64(a.fx);
  w.f64(a.fy);
  w.f64(a.fz);
  w.f64(a.heightAboveGround);
  w.f64(a.airSpeedCap);
  w.f64(a.lastImpactMps);
  w.f64(a.recoverAccelMult);
  w.u32(a.coyoteTicks);
  w.u32(a.jumpBufferTicks);
  w.u32(a.snapOffTicks);
  w.u32(a.hopCharges);
  w.u32(a.hopRechargeTicks);
  w.u32(a.hopIntervalTicks);
  w.u32(a.recoverTicks);
  w.u32(a.moveLockTicks);
  w.u32(a.jumpLockTicks);
  w.u32(a.plotHint);
  w.u8(t.toolCode);
  w.u8(t.holsterSlot);
  w.u16(
    (t.sweeping ? TOOL_FLAG_SWEEPING : 0) |
      (t.detailing ? TOOL_FLAG_DETAILING : 0) |
      (t.wasActive ? TOOL_FLAG_WAS_ACTIVE : 0) |
      (t.laneLocked ? TOOL_FLAG_LANE_LOCKED : 0) |
      (t.headValid ? TOOL_FLAG_HEAD_VALID : 0) |
      (t.inContact ? TOOL_FLAG_IN_CONTACT : 0) |
      (t.speedLifted ? TOOL_FLAG_SPEED_LIFTED : 0) |
      (t.anchorValid ? TOOL_FLAG_ANCHOR_VALID : 0) |
      (t.lastContactValid ? TOOL_FLAG_LAST_CONTACT_VALID : 0) |
      (t.nearFullLatched ? TOOL_FLAG_NEAR_FULL : 0) |
      (t.fullLatched ? TOOL_FLAG_FULL : 0),
  );
  w.u32(t.swapTicks);
  w.u32(t.owned >>> 0);
  w.u16(t.seqAtToolDown);
  w.u16(t.mgAccum);
  w.i32(t.detailCooldownMs);
  w.u32(t.rejectedFull);
  w.f64(t.aim01);
  w.f64(t.laneAngle);
  w.f64(t.headX);
  w.f64(t.headY);
  w.f64(t.headZ);
  w.f64(t.anchorX);
  w.f64(t.anchorY);
  w.f64(t.anchorZ);
  w.f64(t.lastX);
  w.f64(t.lastY);
  w.f64(t.lastZ);
  for (let k = 0; k < t.cellGrams.length; k++) w.i32(t.cellGrams[k]!);
  w.u16(input.seq);
  w.u16(input.yaw);
  w.u16(input.buttons);
  w.u16(input.prevButtons);
  w.i8(input.moveX);
  w.i8(input.moveY);
  w.i8(input.pitch);
  w.u8(input.toolParam);
  w.u8(lampOn ? ACTOR_FLAG_LAMP : 0);
}

function readCheckpointPlayer(r: CheckpointReader, p: CheckpointPlayer): void {
  const a = p.avatar;
  const t = p.tool;
  p.slot = r.u8();
  const af = r.u8();
  p.avatarFlags = af;
  a.jumped = (af & AVATAR_FLAG_JUMPED) !== 0;
  a.jumpCutUsed = (af & AVATAR_FLAG_JUMP_CUT_USED) !== 0;
  a.touchdown = (af & AVATAR_FLAG_TOUCHDOWN) !== 0;
  a.yawFrame = (af & AVATAR_FLAG_YAW_FRAME) !== 0 ? 1 : 0;
  a.moveState = r.u8();
  a.lastLanding = r.u8();
  a.px = r.f64();
  a.py = r.f64();
  a.pz = r.f64();
  a.vx = r.f64();
  a.vy = r.f64();
  a.vz = r.f64();
  a.fx = r.f64();
  a.fy = r.f64();
  a.fz = r.f64();
  a.heightAboveGround = r.f64();
  a.airSpeedCap = r.f64();
  a.lastImpactMps = r.f64();
  a.recoverAccelMult = r.f64();
  a.coyoteTicks = r.u32();
  a.jumpBufferTicks = r.u32();
  a.snapOffTicks = r.u32();
  a.hopCharges = r.u32();
  a.hopRechargeTicks = r.u32();
  a.hopIntervalTicks = r.u32();
  a.recoverTicks = r.u32();
  a.moveLockTicks = r.u32();
  a.jumpLockTicks = r.u32();
  a.plotHint = r.u32();
  t.toolCode = r.u8();
  t.holsterSlot = r.u8();
  const tf = r.u16();
  p.toolFlags = tf;
  t.sweeping = (tf & TOOL_FLAG_SWEEPING) !== 0;
  t.detailing = (tf & TOOL_FLAG_DETAILING) !== 0;
  t.wasActive = (tf & TOOL_FLAG_WAS_ACTIVE) !== 0;
  t.laneLocked = (tf & TOOL_FLAG_LANE_LOCKED) !== 0;
  t.headValid = (tf & TOOL_FLAG_HEAD_VALID) !== 0;
  t.inContact = (tf & TOOL_FLAG_IN_CONTACT) !== 0;
  t.speedLifted = (tf & TOOL_FLAG_SPEED_LIFTED) !== 0;
  t.anchorValid = (tf & TOOL_FLAG_ANCHOR_VALID) !== 0;
  t.lastContactValid = (tf & TOOL_FLAG_LAST_CONTACT_VALID) !== 0;
  t.nearFullLatched = (tf & TOOL_FLAG_NEAR_FULL) !== 0;
  t.fullLatched = (tf & TOOL_FLAG_FULL) !== 0;
  t.swapTicks = r.u32();
  t.owned = r.u32() | 0;
  t.seqAtToolDown = r.u16();
  t.mgAccum = r.u16();
  t.detailCooldownMs = r.i32();
  t.rejectedFull = r.u32();
  t.aim01 = r.f64();
  t.laneAngle = r.f64();
  t.headX = r.f64();
  t.headY = r.f64();
  t.headZ = r.f64();
  t.anchorX = r.f64();
  t.anchorY = r.f64();
  t.anchorZ = r.f64();
  t.lastX = r.f64();
  t.lastY = r.f64();
  t.lastZ = r.f64();
  for (let k = 0; k < t.cellGrams.length; k++) t.cellGrams[k] = r.i32();
  p.seq = r.u16();
  p.yaw = r.u16();
  p.buttons = r.u16();
  p.prevButtons = r.u16();
  p.moveX = r.i8();
  p.moveY = r.i8();
  p.pitch = r.i8();
  p.toolParam = r.u8();
  const cf = r.u8();
  p.actorFlags = cf;
  p.lampOn = (cf & ACTOR_FLAG_LAMP) !== 0;
}

/** Bytes of a PLAYERS body holding `count` records. */
export function simCheckpointPlayersBytes(count: number, toolCount: number): number {
  return 2 + count * simCheckpointPlayerRecordBytes(toolCount);
}

/** Parses a PLAYERS body written for a table of `toolCount` tools (shape only). */
export function decodeCheckpointPlayers(bytes: Uint8Array, toolCount: number): CheckpointPlayer[] | CheckpointFail {
  const r = new CheckpointReader(bytes);
  const count = r.u8();
  const savedToolCount = r.u8();
  if (r.failed) return new CheckpointFail("malformed", "players.length");
  if (count > MAX_PLAYERS_PER_ROOM) return new CheckpointFail("malformed", "players.count");
  if (savedToolCount !== toolCount) return new CheckpointFail("config_mismatch", "players.toolCount");
  if (bytes.length !== simCheckpointPlayersBytes(count, toolCount)) {
    return new CheckpointFail("malformed", "players.length");
  }
  const players: CheckpointPlayer[] = [];
  let seen = 0;
  for (let i = 0; i < count; i++) {
    const p = new CheckpointPlayer(toolCount);
    readCheckpointPlayer(r, p);
    if (r.failed) return new CheckpointFail("malformed", "players.length");
    if (p.slot >= MAX_PLAYERS_PER_ROOM) return new CheckpointFail("out_of_range", "player.slot");
    if ((seen >> p.slot) & 1) return new CheckpointFail("malformed", "player.slot");
    seen |= 1 << p.slot;
    players.push(p);
  }
  if (!r.done) return new CheckpointFail("malformed", "players.length");
  return players;
}

/** Sanity bounds derived once from the config (not balance values: nothing legitimate ever comes near them). */
export interface CheckpointLimits {
  /** Distance from the moon centre a body or tool head may have, metres. */
  readonly radiusMinM: number;
  readonly radiusMaxM: number;
  /** Largest speed accepted: twice a free fall through one moon radius plus every burst the sim can add. */
  readonly speedMaxMps: number;
  readonly recoverTicksMax: number;
  readonly recoverMultMax: number;
  readonly periodMsMax: number;
  readonly plotCount: number;
}

export function checkpointLimits(cfg: SimConfig, plotCount: number): CheckpointLimits {
  const F = cfg.feel;
  let periodMsMax = 0;
  for (const t of cfg.tools) if (t.periodMs > periodMsMax) periodMsMax = t.periodMs;
  return Object.freeze({
    radiusMinM: cfg.moonRadiusM / 2,
    radiusMaxM: cfg.moonRadiusM * 2,
    speedMaxMps:
      2 * Math.sqrt(2 * cfg.gravityMps2 * cfg.moonRadiusM) +
      F.hopMaxHorizontalMps +
      F.hopMaxUpMps +
      cfg.lopeMps +
      cfg.jumpV0Mps,
    recoverTicksMax: Math.max(cfg.landMediumTicks, cfg.landHeavyTicks),
    recoverMultMax: Math.max(1, F.landMediumAccelMult, F.landHeavyAccelMult),
    periodMsMax,
    plotCount,
  });
}

/** Values the room resolves from the validated META before it checks the players. */
export interface CheckpointPlayerContext {
  readonly cfg: SimConfig;
  readonly limits: CheckpointLimits;
  /** Standard Issue mask after the restore (saved mask plus the free tools). */
  readonly standardIssueOwned: number;
  readonly hopMaxCharges: number;
  /** Dust Cell level per tool code, from the restored suit gear. */
  readonly cellLevel: Uint8Array;
}

function inRange(x: number, lo: number, hi: number): boolean {
  return x >= lo && x <= hi; // false for NaN
}

function pointOk(x: number, y: number, z: number, max: number): boolean {
  return inRange(x, -max, max) && inRange(y, -max, max) && inRange(z, -max, max);
}

/**
 * Checks one decoded record and clamps its tunable-bound values in place (counted in `tally`). Returns the rejection,
 * or null when the record may be committed.
 */
export function validateCheckpointPlayer(
  p: CheckpointPlayer,
  ctx: CheckpointPlayerContext,
  tally: CheckpointTally,
): CheckpointFail | null {
  const cfg = ctx.cfg;
  const lim = ctx.limits;
  const a = p.avatar;
  const t = p.tool;
  const clampTicks = (v: number, max: number): number => {
    if (v <= max) return v;
    tally.clamped++;
    return max;
  };

  // Avatar.
  if ((p.avatarFlags & ~AVATAR_FLAGS_KNOWN) !== 0) return new CheckpointFail("malformed", "avatar.flags");
  if (a.moveState > MOVE_HOPPING) return new CheckpointFail("out_of_range", "avatar.moveState");
  if (a.lastLanding > LAND_FACEPLANT) return new CheckpointFail("out_of_range", "avatar.lastLanding");
  const radius = Math.sqrt(a.px * a.px + a.py * a.py + a.pz * a.pz);
  if (!inRange(radius, lim.radiusMinM, lim.radiusMaxM)) return new CheckpointFail("out_of_range", "avatar.position");
  const speed = Math.sqrt(a.vx * a.vx + a.vy * a.vy + a.vz * a.vz);
  if (!inRange(speed, 0, lim.speedMaxMps)) return new CheckpointFail("out_of_range", "avatar.velocity");
  const facing = Math.sqrt(a.fx * a.fx + a.fy * a.fy + a.fz * a.fz);
  if (!inRange(facing, 0.5, 1.5)) return new CheckpointFail("out_of_range", "avatar.facing");
  if (!inRange(a.heightAboveGround, -lim.radiusMaxM, lim.radiusMaxM)) {
    return new CheckpointFail("out_of_range", "avatar.heightAboveGround");
  }
  if (!inRange(a.airSpeedCap, 0, lim.speedMaxMps)) return new CheckpointFail("out_of_range", "avatar.airSpeedCap");
  if (!inRange(a.lastImpactMps, 0, lim.speedMaxMps)) return new CheckpointFail("out_of_range", "avatar.lastImpactMps");
  if (!inRange(a.recoverAccelMult, 0, lim.recoverMultMax)) {
    return new CheckpointFail("out_of_range", "avatar.recoverAccelMult");
  }
  if (a.plotHint >= lim.plotCount) return new CheckpointFail("out_of_range", "avatar.plotHint");
  a.coyoteTicks = clampTicks(a.coyoteTicks, cfg.coyoteTicks);
  a.jumpBufferTicks = clampTicks(a.jumpBufferTicks, cfg.jumpBufferTicks);
  a.snapOffTicks = clampTicks(a.snapOffTicks, cfg.snapOffTicks);
  a.hopMaxCharges = ctx.hopMaxCharges;
  a.hopCharges = clampTicks(a.hopCharges, ctx.hopMaxCharges);
  a.hopRechargeTicks = clampTicks(a.hopRechargeTicks, cfg.hopRechargeTicks);
  a.hopIntervalTicks = clampTicks(a.hopIntervalTicks, cfg.hopMinIntervalTicks);
  a.recoverTicks = clampTicks(a.recoverTicks, lim.recoverTicksMax);
  a.moveLockTicks = clampTicks(a.moveLockTicks, cfg.faceplantMoveTicks);
  a.jumpLockTicks = clampTicks(a.jumpLockTicks, cfg.faceplantJumpTicks);

  // Tool, holster and ownership.
  const toolCount = cfg.tools.length;
  if ((p.toolFlags & ~TOOL_FLAGS_KNOWN) !== 0) return new CheckpointFail("malformed", "tool.flags");
  if (t.toolCode >= toolCount) return new CheckpointFail("out_of_range", "tool.toolCode");
  if (t.holsterSlot >= HOLSTER_SLOT_COUNT) return new CheckpointFail("out_of_range", "tool.holsterSlot");
  if (t.owned >>> 0 >= 2 ** toolCount) return new CheckpointFail("out_of_range", "tool.owned");
  if ((t.owned & ctx.standardIssueOwned) !== ctx.standardIssueOwned) {
    return new CheckpointFail("out_of_range", "tool.owned"); // every member holds the Standard Issue tools
  }
  const equipped = cfg.tools[t.toolCode]!;
  if (!(equipped.cleans && ((t.owned >> t.toolCode) & 1) === 1)) {
    // Only legal when the actor owns no cleaning tool at all (then the room parks on tool code 0).
    let ownsCleaning = false;
    for (const tl of cfg.tools) if (tl.cleans && ((t.owned >> tl.code) & 1) === 1) ownsCleaning = true;
    if (ownsCleaning || t.toolCode !== 0) return new CheckpointFail("out_of_range", "tool.toolCode");
  }
  t.swapTicks = clampTicks(t.swapTicks, cfg.holsterSwapTicks);
  if (t.mgAccum >= MG_PER_GRAM) return new CheckpointFail("out_of_range", "tool.mgAccum");
  if (t.detailCooldownMs > lim.periodMsMax) {
    t.detailCooldownMs = lim.periodMsMax;
    tally.clamped++;
  }
  if (!inRange(t.aim01, 0, 1)) return new CheckpointFail("out_of_range", "tool.aim01");
  if (!inRange(t.laneAngle, 0, TWO_PI)) return new CheckpointFail("out_of_range", "tool.laneAngle");
  if (
    !pointOk(t.headX, t.headY, t.headZ, lim.radiusMaxM) ||
    !pointOk(t.anchorX, t.anchorY, t.anchorZ, lim.radiusMaxM) ||
    !pointOk(t.lastX, t.lastY, t.lastZ, lim.radiusMaxM)
  ) {
    return new CheckpointFail("out_of_range", "tool.head");
  }

  // Dust Cells: never negative; above capacity (a capacity that shrank since the save) is clamped.
  let cellClamped = false;
  for (let k = 0; k < toolCount; k++) {
    const grams = t.cellGrams[k]!;
    if (grams < 0) return new CheckpointFail("out_of_range", "tool.cellGrams");
    const level = ctx.cellLevel[k]!;
    t.cellLevel[k] = level;
    const cap = cellCapGrams(cfg, cfg.tools[k]!, level);
    if (grams > cap) {
      t.cellGrams[k] = cap;
      tally.clamped++;
      cellClamped = true;
    }
  }
  if (cellClamped) {
    const cap = cellCapGrams(cfg, equipped, t.cellLevel[t.toolCode]!);
    const grams = t.cellGrams[t.toolCode]!;
    t.nearFullLatched = grams >= cap * cfg.toolFeel.cellNearFullFrac;
    t.fullLatched = grams >= cap;
  }

  // Input levels (the same ranges applyInput clamps to).
  if ((p.actorFlags & ~ACTOR_FLAGS_KNOWN) !== 0) return new CheckpointFail("malformed", "actor.flags");
  if (!inRange(p.moveX, -INPUT_AXIS_MAX, INPUT_AXIS_MAX) || !inRange(p.moveY, -INPUT_AXIS_MAX, INPUT_AXIS_MAX)) {
    return new CheckpointFail("out_of_range", "input.move");
  }
  if (!inRange(p.pitch, -127, 127)) return new CheckpointFail("out_of_range", "input.pitch");
  return null;
}

// ---- Commit helpers -------------------------------------------------------------------------------------------------

/** Copies every avatar field except `active` (slot membership belongs to the host). */
export function copyAvatarState(src: Readonly<AvatarState>, dst: AvatarState): void {
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
  dst.jumpCutUsed = src.jumpCutUsed;
  dst.jumped = src.jumped;
  dst.hopCharges = src.hopCharges;
  dst.hopMaxCharges = src.hopMaxCharges;
  dst.hopRechargeTicks = src.hopRechargeTicks;
  dst.hopIntervalTicks = src.hopIntervalTicks;
  dst.recoverTicks = src.recoverTicks;
  dst.recoverAccelMult = src.recoverAccelMult;
  dst.moveLockTicks = src.moveLockTicks;
  dst.jumpLockTicks = src.jumpLockTicks;
  dst.airSpeedCap = src.airSpeedCap;
  dst.touchdown = src.touchdown;
  dst.lastLanding = src.lastLanding;
  dst.lastImpactMps = src.lastImpactMps;
  dst.plotHint = src.plotHint;
}

/** Copies every tool and Dust Cell field (both states must be sized for the same tool table). */
export function copyToolState(src: Readonly<ToolState>, dst: ToolState): void {
  dst.toolCode = src.toolCode;
  dst.holsterSlot = src.holsterSlot;
  dst.swapTicks = src.swapTicks;
  dst.owned = src.owned;
  dst.sweeping = src.sweeping;
  dst.detailing = src.detailing;
  dst.wasActive = src.wasActive;
  dst.seqAtToolDown = src.seqAtToolDown;
  dst.aim01 = src.aim01;
  dst.laneLocked = src.laneLocked;
  dst.laneAngle = src.laneAngle;
  dst.headX = src.headX;
  dst.headY = src.headY;
  dst.headZ = src.headZ;
  dst.headValid = src.headValid;
  dst.inContact = src.inContact;
  dst.speedLifted = src.speedLifted;
  dst.anchorValid = src.anchorValid;
  dst.anchorX = src.anchorX;
  dst.anchorY = src.anchorY;
  dst.anchorZ = src.anchorZ;
  dst.lastContactValid = src.lastContactValid;
  dst.lastX = src.lastX;
  dst.lastY = src.lastY;
  dst.lastZ = src.lastZ;
  dst.detailCooldownMs = src.detailCooldownMs;
  dst.cellGrams.set(src.cellGrams);
  dst.cellLevel.set(src.cellLevel);
  dst.mgAccum = src.mgAccum;
  dst.nearFullLatched = src.nearFullLatched;
  dst.fullLatched = src.fullLatched;
  dst.rejectedFull = src.rejectedFull;
}
