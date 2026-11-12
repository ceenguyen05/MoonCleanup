// @contract protocol/channels v0
// @consumers packages/protocol, apps/client/src/net, apps/server/src/net, apps/server/src/ops (bytes-out counters),
//   tools/bots
//
// The three channels that share one WebSocket and the two message directions. Specification:
// docs/architecture/netcode.md section 2.
//
// Not in v0: the quantization constants of netcode.md section 2 (position, velocity, yaw bit widths). They belong
// in this file and land with the first entity codec contracts (M1 contracts wave); no M0 code reads them.

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
