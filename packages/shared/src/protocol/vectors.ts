// @contract protocol/vectors v1
// @consumers packages/protocol (codec tests), tools/bots (codec self-check)
//
// Golden vectors for bytes messages: decoded payload <-> exact wire bytes (v0: PING, PONG; v1: INPUT, FRAME header,
// Self, a FULL avatar record, a slot change).
// They pin the layouts documented in ./payloads (little-endian, type id in byte 0) so the codec in
// packages/protocol and any other implementation agree bit for bit. Constants only; no codec lives here.
//
// `bytes` is the whole message as specified by netcode.md section 2 ("1-byte message type") and the sizes of
// sections 4.1 / 4.2: byte 0 is the catalog id. How that byte maps onto the transport call is the codec owner's
// decision and does not change these vectors.

import type { PingPayload, PongPayload } from "./payloads";
import type { EntityRecord, FrameFlag, FrameSelf, SlotChange } from "./frame";
import type { InputMessage } from "../sim/input";

/** One decoded payload and the exact bytes it encodes to (and decodes from). */
export interface GoldenVector<T> {
  readonly payload: T;
  /** Byte values 0-255, in wire order. */
  readonly bytes: readonly number[];
}

export const PING_GOLDEN_VECTORS: readonly GoldenVector<PingPayload>[] = [
  { payload: { clientTimeMs: 0 }, bytes: [0x02, 0x00, 0x00, 0x00, 0x00] },
  { payload: { clientTimeMs: 0x12345678 }, bytes: [0x02, 0x78, 0x56, 0x34, 0x12] },
  { payload: { clientTimeMs: 0xffffffff }, bytes: [0x02, 0xff, 0xff, 0xff, 0xff] },
];

export const PONG_GOLDEN_VECTORS: readonly GoldenVector<PongPayload>[] = [
  { payload: { clientTimeMs: 0, serverTick: 0 }, bytes: [0x27, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00] },
  {
    payload: { clientTimeMs: 0x12345678, serverTick: 0x0a0b0c0d },
    bytes: [0x27, 0x78, 0x56, 0x34, 0x12, 0x0d, 0x0c, 0x0b, 0x0a],
  },
  {
    payload: { clientTimeMs: 0xffffffff, serverTick: 0xffffffff },
    bytes: [0x27, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
  },
];

// ---- v1 vectors -------------------------------------------------------------------------------------------------

/** `INPUT` (0x01): count byte, then 10 bytes per input (sim/input INPUT_WIRE). */
export const INPUT_GOLDEN_VECTORS: readonly GoldenVector<InputMessage>[] = [
  {
    payload: {
      inputs: [{ seq: 1, moveX: 127, moveY: -127, yaw: 0x1234, pitch: -64, buttons: 0x2008, toolParam: 200 }],
    },
    // seq 01 00 | moveX 7f | moveY 81 | yaw 34 12 | pitch c0 | buttons 08 20 | toolParam c8
    bytes: [0x01, 0x01, 0x01, 0x00, 0x7f, 0x81, 0x34, 0x12, 0xc0, 0x08, 0x20, 0xc8],
  },
  {
    payload: {
      inputs: [
        { seq: 0xffff, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0, toolParam: 0 },
        { seq: 0, moveX: -1, moveY: 1, yaw: 65535, pitch: 127, buttons: 0xffff, toolParam: 255 },
      ],
    },
    bytes: [
      0x01, 0x02, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x01, 0xff, 0xff, 0x7f,
      0xff, 0xff, 0xff,
    ],
  },
];

/** A decoded FRAME header (the flags byte is shown as the decoded flag names). */
export interface FrameHeaderVectorPayload {
  readonly serverTick: number;
  readonly ackInputSeq: number;
  readonly inputBufferDepth: number;
  readonly flags: readonly FrameFlag[];
}

export const FRAME_HEADER_GOLDEN_VECTORS: readonly GoldenVector<FrameHeaderVectorPayload>[] = [
  {
    payload: { serverTick: 0x01020304, ackInputSeq: 0xabcd, inputBufferDepth: 3, flags: ["keyframe"] },
    bytes: [0x20, 0x04, 0x03, 0x02, 0x01, 0xcd, 0xab, 0x03, 0x01],
  },
  {
    payload: {
      serverTick: 0,
      ackInputSeq: 0,
      inputBufferDepth: 0,
      flags: ["hasSlotChanges", "hasEntities", "hasStrokes", "hasRobotIntents", "hasDustPlots", "hasEvents"],
    },
    bytes: [0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x7e],
  },
];

/** Self section, on foot: 162 bits, 21 B. Positions are `steps / 2048` m, velocities `steps / 256` m/s. */
export const FRAME_SELF_ON_FOOT_GOLDEN_VECTORS: readonly GoldenVector<FrameSelf>[] = [
  {
    payload: {
      moveState: "grounded",
      hopCharges: 5,
      position: { x: 1000 / 2048, y: -2000 / 2048, z: 3 / 2048 },
      velocity: { x: 1, y: -1, z: 0 },
      yawCode: 513,
      cellGrams: 123456,
    },
    bytes: [
      0xa0, 0xe8, 0x03, 0x00, 0x30, 0xf8, 0xff, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0xff, 0x00, 0x00, 0x01, 0x02, 0x89,
      0x07, 0x00,
    ],
  },
];

/** Self section while driving: 389 bits, 49 B. */
export const FRAME_SELF_DRIVING_GOLDEN_VECTORS: readonly GoldenVector<FrameSelf>[] = [
  {
    payload: {
      moveState: "seated_driver",
      hopCharges: 0,
      position: { x: -2, y: 4, z: 0 },
      velocity: { x: 2, y: 0, z: -2 },
      yawCode: 1023,
      cellGrams: 65000,
      vehicle: {
        position: { x: 1, y: -1, z: 1 / 2048 },
        orientIndex: 2,
        orient: [16383, -16384, 7],
        linearVelocity: { x: 3, y: 0, z: -3 },
        angularVelocity: { x: 1 / 16, y: -1 / 16, z: 0 },
        steer: -127,
        gear: "drive",
        boost: true,
        lights: true,
      },
    },
    bytes: [
      0x03, 0x00, 0xf0, 0xff, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0xfe, 0xff, 0xa3, 0xf7,
      0x03, 0x00, 0x20, 0x00, 0x00, 0xe0, 0xff, 0x07, 0x00, 0x00, 0xf8, 0xff, 0x03, 0x00, 0x1e, 0x00, 0x00, 0x06, 0x00,
      0x00, 0x00, 0xfa, 0x21, 0x00, 0xe0, 0xff, 0x01, 0x00, 0x02, 0x1b,
    ],
  },
];

/** One FULL avatar entity record including its slot and recType prefix: 102 bits, 13 B. Position = `steps * 0.00625`. */
export const FRAME_ENTITY_AVATAR_FULL_GOLDEN_VECTORS: readonly GoldenVector<EntityRecord>[] = [
  {
    payload: {
      slot: 7,
      rec: "full",
      position: { x: 1600 * 0.00625, y: -800 * 0.00625, z: 0 },
      body: { kind: "avatar", yawCode: 300, pitchCode: 40, actionState: 4, toolIndex: 3, flags: 1 },
    },
    bytes: [0x07, 0x00, 0x19, 0x00, 0x38, 0xff, 0x03, 0x00, 0x00, 0x4b, 0x28, 0x31, 0x01],
  },
];

/** One SlotChanges assign record: 44 bits, 6 B. */
export const FRAME_SLOT_CHANGE_GOLDEN_VECTORS: readonly GoldenVector<SlotChange>[] = [
  {
    payload: { op: "assign", slot: 9, entityId: 0xdeadbeef, kind: "vehicle" },
    bytes: [0x09, 0xdf, 0x7d, 0x5b, 0xbd, 0x03],
  },
];
