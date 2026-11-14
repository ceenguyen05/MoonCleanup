// M0 netcode spike codecs (LoadTestRoom, M0-W2-T03). Catalog ids SPIKE_INPUT 0x70, SPIKE_FRAME 0x71, SPIKE_DUST 0x72
// (status `spike`: never sent by a production room). The layouts mimic the sizes of the production INPUT, FRAME and
// dust sections (netcode.md sections 4.1, 4.2, 4.5; WDS section 5.1) so the spike measures realistic bytes and CPU
// without claiming the production ids. They are NOT the production layouts.
//
// As with PING/PONG, Colyseus carries the catalog id as its own type field, so the transport sends BODIES only.
//
// SPIKE_INPUT body (client -> server), little-endian, 1 + 10 n bytes, n in 1..2 (netcode.md section 4.1 INPUT):
//   byte 0        count n
//   per input     seq u16 | moveX i8 (-127..127) | moveY i8 (-127..127) | yaw u16 (65,536 steps) |
//                 pitch i8 (-90..90 degrees) | buttons u16 (13 defined bits) | toolParam u8
//
// SPIKE_FRAME body (server -> client), cap SPIKE_FRAME_MAX_BODY_BYTES:
//   bytes 0-7     header: serverTick u32 | ackInputSeq u16 | inputBufferDepth u8 | flags u8 (SPIKE_FRAME_FLAG_*)
//   bytes 8..     bit-packed sections written by the server (Self 20 B, SlotChanges, Entities, DustStrokes, Events);
//                 layouts documented in apps/server/src/net/spike/frame-encoder.ts. Clients in the spike only read
//                 the header (tick, ack) and count bytes.
//
// SPIKE_DUST body (server -> client, every 4th tick), cap SPIKE_DUST_MAX_BODY_BYTES:
//   bytes 0-9     header: serverTick u32 | plotCount u16 | intentCount u8 | checkCount u8 | ledgerBytes u16
//   then          plotCount x 4 B (PlotId 18 b, state 2 b, remaining 8 b, spare 4 b; WDS dust.plots)
//                 intentCount x 17 B (robot.plot), checkCount x 6 B (chunkId 10 b + hash 32 b + 6 b pad),
//                 ledgerBytes opaque (amortized ledger streaming).
//
// Decoders never throw and never allocate; a wrong length or out-of-range field returns -1 / false.

import { MESSAGE_CATALOG } from "@moon-cleanup/shared";

export const SPIKE_INPUT_ID = MESSAGE_CATALOG.SPIKE_INPUT.id;
export const SPIKE_FRAME_ID = MESSAGE_CATALOG.SPIKE_FRAME.id;
export const SPIKE_DUST_ID = MESSAGE_CATALOG.SPIKE_DUST.id;

/** Bytes of one input record. */
export const SPIKE_INPUT_RECORD_BYTES = 10;
/** Most inputs in one SPIKE_INPUT message (a client that fell behind sends two). */
export const SPIKE_INPUT_MAX_COUNT = 2;
/** Largest valid SPIKE_INPUT body. */
export const SPIKE_INPUT_MAX_BODY_BYTES = 1 + SPIKE_INPUT_RECORD_BYTES * SPIKE_INPUT_MAX_COUNT;
/** Defined button bits (13: jump .. seatSwitch, game-feel section 9). Any other bit is malformed. */
export const SPIKE_INPUT_BUTTON_MASK = 0x1fff;
/** Button bit of the primary tool (cleaning). */
export const SPIKE_BUTTON_TOOL_PRIMARY = 1 << 3;
/** Pitch range in degrees. */
export const SPIKE_PITCH_MAX_DEG = 90;

/** FRAME cap is 1,000 B including the type byte (netcode.md section 4.2). */
export const SPIKE_FRAME_MAX_BODY_BYTES = 999;
export const SPIKE_FRAME_HEADER_BYTES = 8;
export const SPIKE_FRAME_FLAG_KEYFRAME = 1 << 0;
export const SPIKE_FRAME_FLAG_SLOT_CHANGES = 1 << 1;
export const SPIKE_FRAME_FLAG_ENTITIES = 1 << 2;
export const SPIKE_FRAME_FLAG_STROKES = 1 << 3;
export const SPIKE_FRAME_FLAG_EVENTS = 1 << 6;

/** Bulk dust messages are sliced to <= 4 KB (WDS section 5.1). */
export const SPIKE_DUST_MAX_BODY_BYTES = 4096;
export const SPIKE_DUST_HEADER_BYTES = 10;
export const SPIKE_DUST_PLOT_BYTES = 4;
export const SPIKE_DUST_INTENT_BYTES = 17;
export const SPIKE_DUST_CHECK_BYTES = 6;

/** One decoded input (mutable target for allocation-free decoding). */
export interface SpikeInput {
  seq: number;
  moveX: number;
  moveY: number;
  yaw: number;
  pitch: number;
  buttons: number;
  toolParam: number;
}

export function createSpikeInput(): SpikeInput {
  return { seq: 0, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0, toolParam: 0 };
}

// Byte helpers instead of DataView: a DataView per call is a heap allocation on the hot path (measured in the spike).
const getU8 = (b: Uint8Array, at: number): number => b[at] ?? 0;
const getI8 = (b: Uint8Array, at: number): number => (getU8(b, at) << 24) >> 24;
const getU16 = (b: Uint8Array, at: number): number => getU8(b, at) | (getU8(b, at + 1) << 8);
const getU32 = (b: Uint8Array, at: number): number =>
  (getU8(b, at) | (getU8(b, at + 1) << 8) | (getU8(b, at + 2) << 16) | (getU8(b, at + 3) << 24)) >>> 0;
const setU8 = (b: Uint8Array, at: number, v: number): void => {
  b[at] = v & 0xff;
};
const setU16 = (b: Uint8Array, at: number, v: number): void => {
  b[at] = v & 0xff;
  b[at + 1] = (v >>> 8) & 0xff;
};
const setU32 = (b: Uint8Array, at: number, v: number): void => {
  b[at] = v & 0xff;
  b[at + 1] = (v >>> 8) & 0xff;
  b[at + 2] = (v >>> 16) & 0xff;
  b[at + 3] = (v >>> 24) & 0xff;
};

const clampInt = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : 0;

/**
 * Writes a SPIKE_INPUT body with the first `count` (1-2) entries of `inputs` into `out` at `offset`. Fields are
 * clamped/wrapped to their wire ranges. Returns the bytes written. Throws RangeError on a bad count or a short buffer
 * (programming errors on the sending side only).
 */
export function writeSpikeInputBody(inputs: readonly SpikeInput[], count: number, out: Uint8Array, offset = 0): number {
  if (!Number.isInteger(count) || count < 1 || count > SPIKE_INPUT_MAX_COUNT || count > inputs.length) {
    throw new RangeError("SPIKE_INPUT count must be 1-2");
  }
  const length = 1 + SPIKE_INPUT_RECORD_BYTES * count;
  if (out.byteLength - offset < length) throw new RangeError("SPIKE_INPUT body does not fit");
  setU8(out, offset, count);
  for (let i = 0; i < count; i++) {
    const input = inputs[i] as SpikeInput;
    const at = offset + 1 + i * SPIKE_INPUT_RECORD_BYTES;
    setU16(out, at, clampInt(input.seq, 0, 0xffff_ffff) & 0xffff);
    setU8(out, at + 2, clampInt(input.moveX, -127, 127));
    setU8(out, at + 3, clampInt(input.moveY, -127, 127));
    setU16(out, at + 4, clampInt(input.yaw, 0, 0xffff_ffff) & 0xffff);
    setU8(out, at + 6, clampInt(input.pitch, -SPIKE_PITCH_MAX_DEG, SPIKE_PITCH_MAX_DEG));
    setU16(out, at + 7, clampInt(input.buttons, 0, 0xffff) & SPIKE_INPUT_BUTTON_MASK);
    setU8(out, at + 9, clampInt(input.toolParam, 0, 255));
  }
  return length;
}

/**
 * Decodes a SPIKE_INPUT body into `targets[0..n)`. Returns n (1-2), or -1 when the body is malformed: wrong length
 * for its count, count outside 1-2, moveX/moveY = -128, |pitch| > 90 or an undefined button bit. On -1 the targets
 * may be partially written; the caller drops the whole message.
 */
export function readSpikeInputBody(body: Uint8Array, targets: readonly SpikeInput[]): number {
  if (body.byteLength < 1 + SPIKE_INPUT_RECORD_BYTES || body.byteLength > SPIKE_INPUT_MAX_BODY_BYTES) return -1;
  const count = body[0] ?? 0;
  if (count < 1 || count > SPIKE_INPUT_MAX_COUNT || count > targets.length) return -1;
  if (body.byteLength !== 1 + SPIKE_INPUT_RECORD_BYTES * count) return -1;
  for (let i = 0; i < count; i++) {
    const at = 1 + i * SPIKE_INPUT_RECORD_BYTES;
    const moveX = getI8(body, at + 2);
    const moveY = getI8(body, at + 3);
    const pitch = getI8(body, at + 6);
    const buttons = getU16(body, at + 7);
    if (moveX === -128 || moveY === -128) return -1;
    if (pitch < -SPIKE_PITCH_MAX_DEG || pitch > SPIKE_PITCH_MAX_DEG) return -1;
    if ((buttons & ~SPIKE_INPUT_BUTTON_MASK) !== 0) return -1;
    const target = targets[i] as SpikeInput;
    target.seq = getU16(body, at);
    target.moveX = moveX;
    target.moveY = moveY;
    target.yaw = getU16(body, at + 4);
    target.pitch = pitch;
    target.buttons = buttons;
    target.toolParam = getU8(body, at + 9);
  }
  return count;
}

/** SPIKE_FRAME header fields (mutable target for allocation-free decoding). */
export interface SpikeFrameHeader {
  serverTick: number;
  ackInputSeq: number;
  inputBufferDepth: number;
  flags: number;
}

export function createSpikeFrameHeader(): SpikeFrameHeader {
  return { serverTick: 0, ackInputSeq: 0, inputBufferDepth: 0, flags: 0 };
}

/** Writes the 8-byte SPIKE_FRAME header at `offset`. Returns SPIKE_FRAME_HEADER_BYTES. */
export function writeSpikeFrameHeader(header: SpikeFrameHeader, out: Uint8Array, offset = 0): number {
  if (out.byteLength - offset < SPIKE_FRAME_HEADER_BYTES) throw new RangeError("SPIKE_FRAME header does not fit");
  setU32(out, offset, header.serverTick >>> 0);
  setU16(out, offset + 4, header.ackInputSeq & 0xffff);
  setU8(out, offset + 6, Math.min(255, Math.max(0, header.inputBufferDepth | 0)));
  setU8(out, offset + 7, header.flags & 0xff);
  return SPIKE_FRAME_HEADER_BYTES;
}

/**
 * Reads the SPIKE_FRAME header into `target`. Returns false (target untouched) when the body is shorter than the
 * header or longer than the frame cap.
 */
export function readSpikeFrameHeader(body: Uint8Array, target: SpikeFrameHeader): boolean {
  if (body.byteLength < SPIKE_FRAME_HEADER_BYTES || body.byteLength > SPIKE_FRAME_MAX_BODY_BYTES) return false;
  target.serverTick = getU32(body, 0);
  target.ackInputSeq = getU16(body, 4);
  target.inputBufferDepth = getU8(body, 6);
  target.flags = getU8(body, 7);
  return true;
}

/** SPIKE_DUST header fields. */
export interface SpikeDustHeader {
  serverTick: number;
  plotCount: number;
  intentCount: number;
  checkCount: number;
  ledgerBytes: number;
}

export function createSpikeDustHeader(): SpikeDustHeader {
  return { serverTick: 0, plotCount: 0, intentCount: 0, checkCount: 0, ledgerBytes: 0 };
}

/** Total SPIKE_DUST body length implied by a header. */
export function spikeDustBodyLength(header: SpikeDustHeader): number {
  return (
    SPIKE_DUST_HEADER_BYTES +
    header.plotCount * SPIKE_DUST_PLOT_BYTES +
    header.intentCount * SPIKE_DUST_INTENT_BYTES +
    header.checkCount * SPIKE_DUST_CHECK_BYTES +
    header.ledgerBytes
  );
}

/** Writes the 10-byte SPIKE_DUST header at `offset`. Returns SPIKE_DUST_HEADER_BYTES. */
export function writeSpikeDustHeader(header: SpikeDustHeader, out: Uint8Array, offset = 0): number {
  if (out.byteLength - offset < SPIKE_DUST_HEADER_BYTES) throw new RangeError("SPIKE_DUST header does not fit");
  setU32(out, offset, header.serverTick >>> 0);
  setU16(out, offset + 4, header.plotCount & 0xffff);
  setU8(out, offset + 6, header.intentCount & 0xff);
  setU8(out, offset + 7, header.checkCount & 0xff);
  setU16(out, offset + 8, header.ledgerBytes & 0xffff);
  return SPIKE_DUST_HEADER_BYTES;
}

/**
 * Reads the SPIKE_DUST header into `target` and checks that the body length equals the length the header implies
 * (so a decoder can trust the counts without allocating on them). Returns false (target untouched) otherwise.
 */
export function readSpikeDustHeader(body: Uint8Array, target: SpikeDustHeader): boolean {
  if (body.byteLength < SPIKE_DUST_HEADER_BYTES || body.byteLength > SPIKE_DUST_MAX_BODY_BYTES) return false;
  const serverTick = getU32(body, 0);
  const plotCount = getU16(body, 4);
  const intentCount = getU8(body, 6);
  const checkCount = getU8(body, 7);
  const ledgerBytes = getU16(body, 8);
  const expected =
    SPIKE_DUST_HEADER_BYTES +
    plotCount * SPIKE_DUST_PLOT_BYTES +
    intentCount * SPIKE_DUST_INTENT_BYTES +
    checkCount * SPIKE_DUST_CHECK_BYTES +
    ledgerBytes;
  if (expected !== body.byteLength) return false;
  target.serverTick = serverTick;
  target.plotCount = plotCount;
  target.intentCount = intentCount;
  target.checkCount = checkCount;
  target.ledgerBytes = ledgerBytes;
  return true;
}
