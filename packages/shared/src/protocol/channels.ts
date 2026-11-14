// @contract protocol/channels v1
// @consumers packages/protocol, apps/client/src/net, apps/server/src/net, apps/server/src/ops (bytes-out counters),
//   tools/bots
//
// The three channels that share one WebSocket and the two message directions. Specification:
// docs/architecture/netcode.md section 2.
//
// v1 adds the quantization constants of netcode.md section 2 (`QUANT`) and the bit-packing convention
// (`BIT_PACKING`). v0 consumers are unaffected.

/** How a message or state update travels (netcode.md section 2). */
export const Channel = {
  /**
   * Colyseus Schema state patches: encode once for all clients, server-only writes, patched on frame ticks.
   * Low-rate shared state (`ShiftState`).
   */
  Schema: "schema",
  /**
   * `sendBytes` / `onMessageBytes` with our own codec: little-endian, 1-byte message type, bit-packed sections.
   * Everything per-client or high-rate.
   */
  Bytes: "bytes",
  /** Colyseus typed messages (msgpack), validated by a zod schema per message type. Rare control requests. */
  Control: "control",
} as const;
export type Channel = (typeof Channel)[keyof typeof Channel];

/** Every channel, in the order of the netcode.md section 2 table. */
export const CHANNELS = [Channel.Schema, Channel.Bytes, Channel.Control] as const;

/** Who sends a message. */
export const Direction = {
  ClientToServer: "c2s",
  ServerToClient: "s2c",
} as const;
export type Direction = (typeof Direction)[keyof typeof Direction];

/** Both directions. */
export const DIRECTIONS = [Direction.ClientToServer, Direction.ServerToClient] as const;

// ---- Bit packing and quantization (netcode.md section 2) ----------------------------------------------------------

/**
 * Convention of every bit-packed section (FRAME Self, entity records, SlotChanges, dust sections): a little-endian
 * bit stream. A field's bit 0 is written to the lowest free bit of the current byte; fields are written in table
 * order; signed fields are two's complement of the stated width; each record ends on a byte boundary, the unused high
 * bits of its last byte are zero. Decoders reject a record whose padding bits are not zero.
 */
export const BIT_PACKING = {
  byteOrder: "little-endian",
  bitOrder: "lsb-first",
  signed: "two-complement",
  recordAlignment: "byte",
} as const;

/** Quantization rule: `q = clamp(Math.round(value / resolution), min, max)`; decode is `q * resolution`. */
export const QUANT_ROUNDING = "Math.round" as const;

/**
 * Quantization constants. Moon radius R = 2,000 m (WDS section 0); ranges include relief and the flight ceiling.
 * `bits` is the width of one axis or field; `resolution` its step in the field's unit; the range is
 * +-(2^(bits-1)) * resolution for signed fields.
 */
export const QUANT = {
  /** World position of other entities: 3 x 20-bit signed, moon-centred frame, 6.25 mm, +-3,276.8 m. */
  positionOthers: { bits: 20, resolutionM: 0.00625, rangeM: 3276.8 },
  /** Own position (reconciliation): 3 x 24-bit signed, 1/2048 m (0.49 mm), +-4,096 m. */
  positionOwn: { bits: 24, resolutionM: 1 / 2048, rangeM: 4096 },
  /** Position delta: 2-bit size class per axis (0 unchanged, 1 8-bit, 2 13-bit, 3 absolute 20-bit), 6.25 mm. */
  positionDelta: {
    classBits: 2,
    classAxisBits: [0, 8, 13, 20],
    unchanged: 0,
    small: 1,
    medium: 2,
    absolute: 3,
    resolutionM: 0.00625,
  },
  /** Own velocity: 3 x 16-bit signed, 1/256 m/s, +-128 m/s. */
  velocityOwn: { bits: 16, resolutionMps: 1 / 256, rangeMps: 128 },
  /** Avatar yaw about local up: 10 bits over 0 .. 2 pi (0.35 degrees). */
  yaw: { bits: 10, steps: 1024 },
  /** Look / tool pitch: 6 bits over -90 .. +90 degrees (2.9 degrees). */
  pitch: { bits: 6, steps: 64 },
  /** Vehicle orientation: smallest-three quaternion, 2-bit index of the dropped component + 3 x 10 bits. */
  vehicleOrientation: { indexBits: 2, componentBits: 10 },
  /** Own vehicle orientation (reconciliation): 2 + 3 x 15 bits. */
  vehicleOrientationOwn: { indexBits: 2, componentBits: 15 },
  /** Tick: u32 (20 Hz gives 6.8 years). */
  tickBits: 32,
} as const;
