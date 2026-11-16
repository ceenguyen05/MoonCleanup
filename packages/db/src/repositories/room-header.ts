// Interim room header blob (M1-W5-T01, codec "room-v3"): the bake hash and the small shared room state (wallet, collected
// Near Parcels, the sim's META save section) that a room restores besides its dust chunks. The full MCSV header envelope
// (structures, robots, players; data-model 3.7) replaces it; until then this keeps the wallet and everything bought
// (Standard Issue tools, suit gear, Promotions Board levels, Roosts) across a room restart in a few hundred bytes.
//
// Layout (little endian):
//   byte 0       flags: bit0 = bake hash present, bit1 = wallet present, bit2 = Near Parcel mask present (v2+),
//                bit3 = sim META section present (v3 only; requires bit1 and bit2)
//   32 bytes     bake hash (only when bit0)
//   8 bytes      wallet lumens, float64 (only when bit1)
//   1 byte       Near Parcel mask, bit k = parcel k collected (only when bit2)
//   u16 version, u16 length, `length` bytes: the sim META section (`MoonRoomSim.captureCheckpoint().meta`; only bit3).
//                The db layer stores it opaquely; the server validates it through `MoonRoomSim.restoreCheckpoint`.
// "room-v2" (read only): the same layout without bit3.
// "room-v1" (read only): the same layout without bit2/bit3. Its wallet has no parcel mask beside it: the server skips
//   that wallet (review B1, a wallet without the mask lets leave/rejoin re-pay the parcels), see shift-persistence.ts.
// "room-v0" (read only): empty blob, or exactly the 32-byte bake hash.

import {
  BAKE_HASH_HEX_RE,
  ROOM_SIM_META_MAX_BYTES,
  ROOM_WALLET_MAX_LM,
  type RoomHeaderState,
  type RoomSimMeta,
} from "./room-types.ts";

const FLAG_BAKE = 1;
const FLAG_WALLET = 2;
const FLAG_PARCELS = 4;
const FLAG_SIM_META = 8;

/** Largest "room-v2" header: flags + bake hash + wallet + parcel mask. */
export const ROOM_HEADER_V2_MAX_BYTES = 1 + 32 + 8 + 1;

/** Largest "room-v3" header: the v2 fields plus the sim META section (u16 version, u16 length, bytes). */
export const ROOM_HEADER_V3_MAX_BYTES = ROOM_HEADER_V2_MAX_BYTES + 4 + ROOM_SIM_META_MAX_BYTES;

export interface DecodedRoomHeader {
  readonly bakeHash: string | null;
  readonly state: RoomHeaderState | null;
}

function validMeta(meta: RoomSimMeta): boolean {
  return (
    Number.isInteger(meta.version) &&
    meta.version >= 1 &&
    meta.version <= 0xffff &&
    meta.bytes instanceof Uint8Array &&
    meta.bytes.byteLength >= 1 &&
    meta.bytes.byteLength <= ROOM_SIM_META_MAX_BYTES
  );
}

function validState(state: RoomHeaderState): boolean {
  if (!Number.isFinite(state.walletLm) || state.walletLm < 0 || state.walletLm > ROOM_WALLET_MAX_LM) return false;
  const m = state.nearParcelsMask;
  if (!(m === undefined || (Number.isInteger(m) && m >= 0 && m <= 0xff))) return false;
  if (state.simMeta === undefined) return true;
  return m !== undefined && validMeta(state.simMeta); // the META section only travels with the wallet and the mask
}

function encodeHeader(
  bakeHash: string | undefined,
  state: RoomHeaderState | undefined,
  allowMeta: boolean,
): Uint8Array {
  if (bakeHash !== undefined && !BAKE_HASH_HEX_RE.test(bakeHash)) {
    throw new RangeError("bakeHash must be 64 lower-case hex characters");
  }
  if (state !== undefined && !validState(state)) {
    throw new RangeError(
      "walletLm must be finite in [0, MAX_SAFE_INTEGER]; nearParcelsMask an integer in [0, 255]; simMeta needs the " +
        `mask, a version in [1, 65535] and 1..${ROOM_SIM_META_MAX_BYTES} bytes`,
    );
  }
  const meta = state?.simMeta;
  if (meta !== undefined && !allowMeta) throw new RangeError("a room-v2 header cannot carry simMeta");
  const hasMask = state?.nearParcelsMask !== undefined;
  const out = new Uint8Array(
    1 +
      (bakeHash === undefined ? 0 : 32) +
      (state === undefined ? 0 : 8) +
      (hasMask ? 1 : 0) +
      (meta === undefined ? 0 : 4 + meta.bytes.byteLength),
  );
  const view = new DataView(out.buffer);
  let at = 1;
  let flags = 0;
  if (bakeHash !== undefined) {
    flags |= FLAG_BAKE;
    for (let i = 0; i < 32; i++) out[at++] = Number.parseInt(bakeHash.slice(i * 2, i * 2 + 2), 16);
  }
  if (state !== undefined) {
    flags |= FLAG_WALLET;
    view.setFloat64(at, state.walletLm, true);
    at += 8;
    if (hasMask) {
      flags |= FLAG_PARCELS;
      out[at++] = state.nearParcelsMask!;
    }
    if (meta !== undefined) {
      flags |= FLAG_SIM_META;
      view.setUint16(at, meta.version, true);
      view.setUint16(at + 2, meta.bytes.byteLength, true);
      out.set(meta.bytes, at + 4);
    }
  }
  out[0] = flags;
  return out;
}

/** Encodes a "room-v3" header (written now). Throws RangeError on a bad bake hash or state (nothing is written). */
export function encodeRoomHeaderV3(bakeHash: string | undefined, state: RoomHeaderState | undefined): Uint8Array {
  return encodeHeader(bakeHash, state, true);
}

/** Encodes a "room-v2" header (tests and tools; rooms write v3). Throws RangeError on a bad input or a `simMeta`. */
export function encodeRoomHeaderV2(bakeHash: string | undefined, state: RoomHeaderState | undefined): Uint8Array {
  return encodeHeader(bakeHash, state, false);
}

function decodeFlagged(blob: Uint8Array, allowed: number): DecodedRoomHeader | null {
  if (blob.byteLength < 1) return null;
  const flags = blob[0]!;
  if ((flags & ~allowed) !== 0) return null;
  const hasBake = (flags & FLAG_BAKE) !== 0;
  const hasWallet = (flags & FLAG_WALLET) !== 0;
  const hasMask = (flags & FLAG_PARCELS) !== 0;
  const hasMeta = (flags & FLAG_SIM_META) !== 0;
  if (hasMask && !hasWallet) return null; // the mask only ever travels with the wallet
  if (hasMeta && !hasMask) return null; // the META section only travels with the wallet and the mask
  const fixed = 1 + (hasBake ? 32 : 0) + (hasWallet ? 8 : 0) + (hasMask ? 1 : 0);
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  let metaLength = 0;
  if (hasMeta) {
    if (blob.byteLength < fixed + 4) return null;
    metaLength = view.getUint16(fixed + 2, true);
    if (metaLength < 1 || metaLength > ROOM_SIM_META_MAX_BYTES) return null;
  }
  if (blob.byteLength !== fixed + (hasMeta ? 4 + metaLength : 0)) return null;
  let at = 1;
  let bakeHash: string | null = null;
  if (hasBake) {
    bakeHash = hexOf(blob.subarray(at, at + 32));
    at += 32;
  }
  let state: RoomHeaderState | null = null;
  if (hasWallet) {
    const walletLm = view.getFloat64(at, true);
    at += 8;
    if (!Number.isFinite(walletLm) || walletLm < 0 || walletLm > ROOM_WALLET_MAX_LM) return null;
    if (!hasMask) state = { walletLm };
    else {
      const nearParcelsMask = blob[at++]!;
      if (!hasMeta) state = { walletLm, nearParcelsMask };
      else {
        const version = view.getUint16(at, true);
        if (version < 1) return null;
        // A copy: the section must not alias the driver's row buffer.
        state = { walletLm, nearParcelsMask, simMeta: { version, bytes: blob.slice(at + 4, at + 4 + metaLength) } };
      }
    }
  }
  return { bakeHash, state };
}

/** Decodes a v3 header; `null` when the bytes are not a well-formed v3 header (callers treat it as corrupt). */
export function decodeRoomHeaderV3(blob: Uint8Array): DecodedRoomHeader | null {
  return decodeFlagged(blob, FLAG_BAKE | FLAG_WALLET | FLAG_PARCELS | FLAG_SIM_META);
}

/** Decodes the read-only "room-v2" header (no sim META section). */
export function decodeRoomHeaderV2(blob: Uint8Array): DecodedRoomHeader | null {
  return decodeFlagged(blob, FLAG_BAKE | FLAG_WALLET | FLAG_PARCELS);
}

/**
 * Decodes the read-only "room-v1" header (no parcel mask: a decoded state has `nearParcelsMask` undefined, which the
 * server treats as "wallet not restorable").
 */
export function decodeRoomHeaderV1(blob: Uint8Array): DecodedRoomHeader | null {
  return decodeFlagged(blob, FLAG_BAKE | FLAG_WALLET);
}

/** Decodes the read-only "room-v0" header (empty, or the 32-byte bake hash). */
export function decodeRoomHeaderV0(blob: Uint8Array): DecodedRoomHeader | null {
  if (blob.byteLength === 0) return { bakeHash: null, state: null };
  if (blob.byteLength === 32) return { bakeHash: hexOf(blob), state: null };
  return null;
}

function hexOf(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
