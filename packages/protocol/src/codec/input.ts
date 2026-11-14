// INPUT codec (client -> server, bytes 0x01). Layout: sim/input INPUT_WIRE in @moon-cleanup/shared; golden vectors:
// INPUT_GOLDEN_VECTORS.
//
//   byte 0 = 0x01 | byte 1 = count n (1 or 2) | n x 10 B: seq u16, moveX i8, moveY i8, yaw u16, pitch i8,
//   buttons u16 (levels), toolParam u8, all little-endian.
//
// Hot path: `encodeInput` writes into a caller-owned buffer and `decodeInput` fills a preallocated `InputBatch`; neither
// allocates. Decoding never throws: a wrong id, length, count or an out-of-contract field (an i8 of -128, which the
// contract schema excludes) returns `false` and the server drops and counts the message (netcode.md section 4.1:
// "exact length 1 + 1 + 10 n (n <= 2)").

import { INPUT_WIRE, type SimInputCommand } from "@moon-cleanup/shared";

export const INPUT_ID = INPUT_WIRE.typeId;
/** Largest INPUT message: header + 2 inputs. */
export const INPUT_MAX_BYTES = INPUT_WIRE.headerBytes + INPUT_WIRE.maxInputsPerMessage * INPUT_WIRE.bytesPerInput;

/** Mutable decoded input (reused). */
export interface MutableInput {
  seq: number;
  moveX: number;
  moveY: number;
  yaw: number;
  pitch: number;
  buttons: number;
  toolParam: number;
}

/** Preallocated decode target; `count` inputs are valid, oldest first. */
export class InputBatch {
  count = 0;
  readonly inputs: readonly [MutableInput, MutableInput] = [newInput(), newInput()];

  /** Copies input `index` into `out` (for handing a decoded input to code that keeps its own object). */
  copyTo(index: 0 | 1, out: MutableInput): void {
    const src = this.inputs[index];
    out.seq = src.seq;
    out.moveX = src.moveX;
    out.moveY = src.moveY;
    out.yaw = src.yaw;
    out.pitch = src.pitch;
    out.buttons = src.buttons;
    out.toolParam = src.toolParam;
  }
}

function newInput(): MutableInput {
  return { seq: 0, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0, toolParam: 0 };
}

/** Message length for `count` inputs. */
export function inputMessageBytes(count: number): number {
  return INPUT_WIRE.headerBytes + count * INPUT_WIRE.bytesPerInput;
}

function clampI8(v: number): number {
  return v < -127 ? -127 : v > 127 ? 127 : v;
}

function writeOne(b: Uint8Array, at: number, input: SimInputCommand): void {
  const seq = input.seq & 0xffff;
  const yaw = input.yaw & 0xffff;
  const buttons = input.buttons & 0xffff;
  b[at] = seq & 0xff;
  b[at + 1] = seq >>> 8;
  b[at + 2] = clampI8(input.moveX) & 0xff;
  b[at + 3] = clampI8(input.moveY) & 0xff;
  b[at + 4] = yaw & 0xff;
  b[at + 5] = yaw >>> 8;
  b[at + 6] = clampI8(input.pitch) & 0xff;
  b[at + 7] = buttons & 0xff;
  b[at + 8] = buttons >>> 8;
  b[at + 9] = input.toolParam & 0xff;
}

/**
 * Encodes one or two inputs (oldest first) as an INPUT message at `out[offset]`. Returns the bytes written. Fields are
 * clamped to the wire ranges (axes and pitch to +-127). Throws `RangeError` only when `out` is too small (a programming
 * error, never an input-dependent one). Allocation-free for any `Uint8Array`.
 */
export function encodeInput(out: Uint8Array, first: SimInputCommand, second?: SimInputCommand, offset = 0): number {
  const n = second === undefined ? 1 : 2;
  const len = inputMessageBytes(n);
  if (out.byteLength - offset < len) throw new RangeError("INPUT does not fit");
  out[offset] = INPUT_ID;
  out[offset + 1] = n;
  writeOne(out, offset + INPUT_WIRE.headerBytes, first);
  if (second !== undefined) writeOne(out, offset + INPUT_WIRE.headerBytes + INPUT_WIRE.bytesPerInput, second);
  return len;
}

function i8(v: number): number {
  return v > 127 ? v - 256 : v;
}

function readOne(b: Uint8Array, at: number, into: MutableInput): boolean {
  const moveX = i8(b[at + 2] ?? 0);
  const moveY = i8(b[at + 3] ?? 0);
  const pitch = i8(b[at + 6] ?? 0);
  if (moveX === -128 || moveY === -128 || pitch === -128) return false;
  into.seq = (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
  into.moveX = moveX;
  into.moveY = moveY;
  into.yaw = (b[at + 4] ?? 0) | ((b[at + 5] ?? 0) << 8);
  into.pitch = pitch;
  into.buttons = (b[at + 7] ?? 0) | ((b[at + 8] ?? 0) << 8);
  into.toolParam = b[at + 9] ?? 0;
  return true;
}

/**
 * Decodes an INPUT message into `batch`. Returns `false` (batch.count = 0) on a wrong id, length, count or an
 * out-of-contract field (an i8 of -128). Never throws, never allocates.
 */
export function decodeInput(message: Uint8Array, batch: InputBatch): boolean {
  batch.count = 0;
  if (message.byteLength < INPUT_WIRE.headerBytes + INPUT_WIRE.bytesPerInput) return false;
  if (message[0] !== INPUT_ID) return false;
  const n = message[1] ?? 0;
  if (n < 1 || n > INPUT_WIRE.maxInputsPerMessage) return false;
  if (message.byteLength !== inputMessageBytes(n)) return false;
  if (!readOne(message, INPUT_WIRE.headerBytes, batch.inputs[0])) return false;
  if (n === 2 && !readOne(message, INPUT_WIRE.headerBytes + INPUT_WIRE.bytesPerInput, batch.inputs[1])) return false;
  batch.count = n;
  return true;
}
