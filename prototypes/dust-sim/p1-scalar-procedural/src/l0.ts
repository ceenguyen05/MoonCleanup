// P1 (scalar + procedural): the L0 record shared by the server, the clients and the wire.
// One u16 per plot: bits 0..7 remaining fraction (0..255 of the plot's starting dust), bits 8..9 the 2-bit plot state
// (shared PlotState codes). Environment-agnostic: no DOM, Node, three.js or Colyseus.

/** Plot state wire codes (same values as PlotState in @moon-cleanup/shared; copied so the core has no runtime import). */
export const STATE_GRIMY = 0;
export const STATE_OPENED = 1;
export const STATE_POLISHED = 2;
export const STATE_EMPTY = 3;

/** Mask of the replicated part of an L0 value (state + fraction). */
export const L0_VALUE_MASK = 0x03ff;
/** Server-only flag: the plot is in the pending `dust.plots` delta list. */
export const L0_DIRTY_BIT = 0x8000;
/** Untouched plot: Grimy, fraction 255. Plots at this value are absent from hashes, snapshots and checkpoints. */
export const L0_DEFAULT = (STATE_GRIMY << 8) | 0xff;

/** Message type ids of the P1 byte stream (prototype only; production ids live in shared/protocol). */
export const MSG_PLOTS = 1;
export const MSG_ACK = 2;
export const MSG_ROBOT = 3;
export const MSG_SNAPSHOT_SPARSE = 4;
export const MSG_SNAPSHOT_RLE = 5;

/** `dust.plots` header: type u8 + record count u16. Records are 4 B (DUST_WIRE.plotDeltaBits = 32). */
export const PLOTS_HEADER_BYTES = 3;
export const PLOT_RECORD_BYTES = 4;
/** Largest record count of one message so it stays inside the 4,096 B slice limit (3 + 4 * 1023 = 4,095). */
export const PLOTS_MAX_RECORDS = 1023;
/** `dust.ack`: type u8 + grams u24. */
export const ACK_BYTES = 4;
/** `robot.plot`: 158 bits of the shared contract, padded to 20 B, plus the type byte. */
export const ROBOT_INTENT_BYTES = 20;
export const ROBOT_MESSAGE_BYTES = 1 + ROBOT_INTENT_BYTES;
/** Snapshot header: type u8 + tick u32 + count u32. */
export const SNAPSHOT_HEADER_BYTES = 9;

export const ACTOR_SLOTS = 64;

/** One wire record: PlotId 18 b | state 2 b | fraction 8 b | 4 b spare. */
export function packRecord(plotId: number, value: number): number {
  return (plotId | ((value & L0_VALUE_MASK) << 18)) >>> 0;
}

/**
 * XORs mix(plotId, value) into `acc[0]`, where mix is FNV-1a 32 over the 8 bytes (plotId u32 LE, value u32 LE): the
 * CHUNK_HASH_MIX of the shared dust contract with the L0 value in place of the ledger hash. Writes into a typed array
 * instead of returning, so no uint32 is ever boxed on the hot path.
 */
export function xorMix(acc: Uint32Array, plotId: number, value: number): void {
  let x = 0x811c9dc5 | 0;
  x = Math.imul(x ^ (plotId & 0xff), 0x01000193);
  x = Math.imul(x ^ ((plotId >>> 8) & 0xff), 0x01000193);
  x = Math.imul(x ^ ((plotId >>> 16) & 0xff), 0x01000193);
  x = Math.imul(x ^ (plotId >>> 24), 0x01000193);
  x = Math.imul(x ^ (value & 0xff), 0x01000193);
  x = Math.imul(x ^ ((value >>> 8) & 0xff), 0x01000193);
  x = Math.imul(x ^ ((value >>> 16) & 0xff), 0x01000193);
  x = Math.imul(x ^ (value >>> 24), 0x01000193);
  acc[0] = (acc[0] ?? 0) ^ x;
}

/** Hash of a whole L0 table (the slow path used after a snapshot or a restore): XOR of mix over non-default plots. */
export function hashTable(l0: Uint16Array, acc: Uint32Array): number {
  acc[0] = 0;
  let nonDefault = 0;
  for (let i = 0; i < l0.length; i++) {
    const v = (l0[i] ?? 0) & L0_VALUE_MASK;
    if (v !== L0_DEFAULT) {
      xorMix(acc, i, v);
      nonDefault++;
    }
  }
  return nonDefault;
}

export function writeU32(buf: Uint8Array, at: number, v: number): void {
  buf[at] = v & 0xff;
  buf[at + 1] = (v >>> 8) & 0xff;
  buf[at + 2] = (v >>> 16) & 0xff;
  buf[at + 3] = v >>> 24;
}

export function readU32(buf: Uint8Array, at: number): number {
  return ((buf[at] ?? 0) | ((buf[at + 1] ?? 0) << 8) | ((buf[at + 2] ?? 0) << 16) | ((buf[at + 3] ?? 0) << 24)) >>> 0;
}
