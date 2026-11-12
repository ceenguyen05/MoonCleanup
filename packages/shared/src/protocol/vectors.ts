// @contract protocol/vectors v0
// @consumers packages/protocol (codec tests), tools/bots (codec self-check)
//
// Golden vectors for the bytes messages that are `active` in protocol v0: decoded payload <-> exact wire bytes.
// They pin the layouts documented in ./payloads (little-endian, type id in byte 0) so the codec in
// packages/protocol and any other implementation agree bit for bit. Constants only; no codec lives here.
//
// `bytes` is the whole message as specified by netcode.md section 2 ("1-byte message type") and the sizes of
// sections 4.1 / 4.2: byte 0 is the catalog id. How that byte maps onto the transport call is the codec owner's
// decision and does not change these vectors.

import type { PingPayload, PongPayload } from "./payloads";

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
