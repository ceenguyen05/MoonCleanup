// PING / PONG codec (protocol v0). Layouts: packages/shared protocol/payloads, pinned by protocol/vectors.
//
// A "message" is the whole catalog message: byte 0 is the catalog id, then the little-endian body. Colyseus'
// `sendBytes(type, body)` carries the id as its own (msgpack fixint) type field, so the transport adapters send and
// receive the BODY only (`*_BODY_BYTES`); the full-message functions exist for golden vectors, bots and tools.
//
// Decoders never throw and never allocate: a wrong length returns `false` (the caller drops and counts it).

import { MESSAGE_CATALOG, PING_WIRE_BYTES, PONG_WIRE_BYTES, type PongPayload } from "@moon-cleanup/shared";

/** Catalog id of PING (first byte of the message). */
export const PING_ID = MESSAGE_CATALOG.PING.id;
/** Catalog id of PONG (first byte of the message). */
export const PONG_ID = MESSAGE_CATALOG.PONG.id;

/** PING body length without the id byte. */
export const PING_BODY_BYTES = PING_WIRE_BYTES - 1;
/** PONG body length without the id byte. */
export const PONG_BODY_BYTES = PONG_WIRE_BYTES - 1;

const U32_MOD = 0x1_0000_0000;

/** Normalises any finite number to an unsigned 32-bit integer (wraps; NaN and infinities become 0). */
export function toU32(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const truncated = Math.trunc(value) % U32_MOD;
  return truncated < 0 ? truncated + U32_MOD : truncated;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Writes a PING body (`clientTimeMs` u32 LE) into `out` at `offset`. Returns the bytes written. */
export function writePingBody(clientTimeMs: number, out: Uint8Array, offset = 0): number {
  if (out.byteLength - offset < PING_BODY_BYTES) throw new RangeError("PING body does not fit");
  viewOf(out).setUint32(offset, toU32(clientTimeMs), true);
  return PING_BODY_BYTES;
}

/** Reads a PING body. Returns `clientTimeMs`, or -1 when the length is not exactly PING_BODY_BYTES. */
export function readPingBody(body: Uint8Array): number {
  if (body.byteLength !== PING_BODY_BYTES) return -1;
  return viewOf(body).getUint32(0, true);
}

/** Writes a full PING message (id + body) into `out`. Returns the bytes written (PING_WIRE_BYTES). */
export function encodePing(clientTimeMs: number, out: Uint8Array, offset = 0): number {
  if (out.byteLength - offset < PING_WIRE_BYTES) throw new RangeError("PING does not fit");
  out[offset] = PING_ID;
  writePingBody(clientTimeMs, out, offset + 1);
  return PING_WIRE_BYTES;
}

/** Decodes a full PING message. Returns `clientTimeMs`, or -1 on a wrong id or length. */
export function decodePing(message: Uint8Array): number {
  if (message.byteLength !== PING_WIRE_BYTES || message[0] !== PING_ID) return -1;
  return readPingBody(message.subarray(1));
}

/** Mutable PONG target for allocation-free decoding. */
export interface PongTarget {
  clientTimeMs: number;
  serverTick: number;
}

/** Writes a PONG body (`clientTimeMs` u32 LE, `serverTick` u32 LE). Returns the bytes written. */
export function writePongBody(pong: PongPayload, out: Uint8Array, offset = 0): number {
  if (out.byteLength - offset < PONG_BODY_BYTES) throw new RangeError("PONG body does not fit");
  const view = viewOf(out);
  view.setUint32(offset, toU32(pong.clientTimeMs), true);
  view.setUint32(offset + 4, toU32(pong.serverTick), true);
  return PONG_BODY_BYTES;
}

/** Reads a PONG body into `target`. Returns `false` (target untouched) when the length is wrong. */
export function readPongBody(body: Uint8Array, target: PongTarget): boolean {
  if (body.byteLength !== PONG_BODY_BYTES) return false;
  const view = viewOf(body);
  target.clientTimeMs = view.getUint32(0, true);
  target.serverTick = view.getUint32(4, true);
  return true;
}

/** Writes a full PONG message (id + body). Returns the bytes written (PONG_WIRE_BYTES). */
export function encodePong(pong: PongPayload, out: Uint8Array, offset = 0): number {
  if (out.byteLength - offset < PONG_WIRE_BYTES) throw new RangeError("PONG does not fit");
  out[offset] = PONG_ID;
  writePongBody(pong, out, offset + 1);
  return PONG_WIRE_BYTES;
}

/** Decodes a full PONG message into `target`. Returns `false` on a wrong id or length. */
export function decodePong(message: Uint8Array, target: PongTarget): boolean {
  if (message.byteLength !== PONG_WIRE_BYTES || message[0] !== PONG_ID) return false;
  return readPongBody(message.subarray(1), target);
}

/**
 * Round-trip time from a PONG, in ms, given the client's current clock (same modulo-2^32 clock as `clientTimeMs`).
 * Wrap-safe. Returns -1 when the echo is from the future or older than `maxAgeMs` (stale or forged).
 */
export function rttFromPong(nowMs: number, echoedClientTimeMs: number, maxAgeMs = 60_000): number {
  const rtt = (toU32(nowMs) - toU32(echoedClientTimeMs) + U32_MOD) % U32_MOD;
  return rtt > maxAgeMs ? -1 : rtt;
}
