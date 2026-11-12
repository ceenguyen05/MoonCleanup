// @contract protocol/payloads v0
// @consumers packages/protocol (PING / PONG codec), apps/client/src/net, apps/server/src/net, tools/bots
//
// Payload contracts of the messages that are `active` in protocol v0 (./messages): HELLO, PING, PONG, plus the two
// shapes of the version handshake (join options and the mismatch info). Specification: docs/architecture/netcode.md
// sections 4.1, 4.2 and 13.
//
// Handshake order (netcode.md section 13):
//   1. The client puts `JoinOptions` ({ protocolVersion, clientBuild }) into the join request.
//   2. The server's `onAuth` compares `protocolVersion` with PROTOCOL_VERSION (strict equality). A mismatch rejects
//      the join with close code 4100 and a `ProtocolMismatchInfo`.
//   3. After a successful join the server sends HELLO as its first message. HELLO is not the version check.
//
// zod schemas describe the DECODED payload objects. The bytes layouts of PING and PONG are documented here and
// pinned by the golden vectors in ./vectors; the codec itself lives in packages/protocol.

import { z } from "zod";
import type { MessageName } from "./messages";

const U8_MAX = 0xff;
const U16_MAX = 0xffff;
const U32_MAX = 0xffff_ffff;

/** Maximum length of a build identifier (commit SHA, `dev`, or a version string). */
export const BUILD_ID_MAX_LENGTH = 64;

/**
 * Build identifier (`VITE_BUILD_VERSION` on the client, `BUILD_VERSION` on the server). ASCII letters, digits and
 * `. _ + -` only, so it is safe in logs and its byte length equals its character count.
 */
export const BuildIdSchema = z
  .string()
  .min(1)
  .max(BUILD_ID_MAX_LENGTH)
  .regex(/^[A-Za-z0-9._+-]+$/);

/** A protocol version as carried on the wire (Schema `protocolVersion` is uint16, netcode.md section 4.4). */
export const ProtocolVersionSchema = z.int().min(0).max(U16_MAX);

/** A tick or snapshot rate in Hz (Schema uint8, netcode.md section 4.4). */
const RateHzSchema = z.int().min(1).max(U8_MAX);

// ---- Join options (client -> server, part of the join request) ---------------------------------------------------

/**
 * Options the client sends with the join request. Unknown keys are stripped, so later versions can add fields (for
 * example the REST join ticket) without breaking this schema.
 */
export const JoinOptionsSchema = z.object({
  /** The client's PROTOCOL_VERSION. */
  protocolVersion: ProtocolVersionSchema,
  /** The client's build identifier. */
  clientBuild: BuildIdSchema,
});
export type JoinOptions = z.infer<typeof JoinOptionsSchema>;

// ---- Protocol mismatch info (server -> client, with close code 4100) ---------------------------------------------

/**
 * What the server reports when it rejects a join with close code 4100. It travels as the JSON text of this object
 * in the rejection message. `/healthz` exposes the same two values (api/rest `HealthResponse`).
 */
export const ProtocolMismatchInfoSchema = z.object({
  serverProtocol: ProtocolVersionSchema,
  serverBuild: BuildIdSchema,
});
export type ProtocolMismatchInfo = z.infer<typeof ProtocolMismatchInfoSchema>;

/**
 * A WebSocket close reason is limited to 123 bytes of UTF-8. The JSON text of a `ProtocolMismatchInfo` is at most
 * 105 bytes (BUILD_ID_MAX_LENGTH keeps it there), so it always fits.
 */
export const CLOSE_REASON_MAX_BYTES = 123;

// ---- HELLO (server -> client, control `hello`) ------------------------------------------------------------------

/**
 * First message the server sends after a successful join: the session parameters the client needs before it starts
 * its clocks. Field names match `ProtocolMismatchInfo` and `HealthResponse`.
 */
export const HelloPayloadSchema = z.object({
  /** The server's PROTOCOL_VERSION (equal to the client's, or the join would have been rejected). */
  serverProtocol: ProtocolVersionSchema,
  /** The server's build identifier. */
  serverBuild: BuildIdSchema,
  /** Fixed simulation rate of this room in Hz (`SIM_TICK_HZ`; 20 on the free tier). */
  simTickHz: RateHzSchema,
  /** Frame and Schema patch rate of this room in Hz (`SNAPSHOT_HZ`; 10 on the free tier). */
  snapshotHz: RateHzSchema,
});
export type HelloPayload = z.infer<typeof HelloPayloadSchema>;

// ---- PING (client -> server, bytes 0x02) ------------------------------------------------------------------------

/**
 * Decoded PING. Wire layout, little-endian, PING_WIRE_BYTES in total:
 *   byte 0      message type id 0x02
 *   bytes 1-4   clientTimeMs u32
 */
export const PingPayloadSchema = z.object({
  /** The client's monotonic clock in milliseconds, modulo 2^32. Echoed unchanged by PONG. */
  clientTimeMs: z.int().min(0).max(U32_MAX),
});
export type PingPayload = z.infer<typeof PingPayloadSchema>;

/** Exact size of a PING message, including the type byte. The server drops any other length. */
export const PING_WIRE_BYTES = 5;

/** The client sends one PING every 2 s, also while the tab is hidden (netcode.md sections 4.1 and 10). */
export const PING_INTERVAL_MS = 2000;

/** Server-side rate limit for PING; extra messages are dropped (netcode.md section 11). */
export const PING_MAX_PER_SECOND = 2;

// ---- PONG (server -> client, bytes 0x27) ------------------------------------------------------------------------

/**
 * Decoded PONG. Wire layout, little-endian, PONG_WIRE_BYTES in total:
 *   byte 0      message type id 0x27
 *   bytes 1-4   clientTimeMs u32 (copied from the PING)
 *   bytes 5-8   serverTick u32
 */
export const PongPayloadSchema = z.object({
  /** `clientTimeMs` of the PING this message answers. */
  clientTimeMs: z.int().min(0).max(U32_MAX),
  /** The server's simulation tick when it answered. */
  serverTick: z.int().min(0).max(U32_MAX),
});
export type PongPayload = z.infer<typeof PongPayloadSchema>;

/** Exact size of a PONG message, including the type byte. */
export const PONG_WIRE_BYTES = 9;

// ---- Payload schema per active catalog entry --------------------------------------------------------------------

/**
 * One zod schema per `active` message of the catalog, keyed by catalog name. A catalog test checks that the keys
 * are exactly the active entries.
 */
export const PAYLOAD_SCHEMAS = {
  HELLO: HelloPayloadSchema,
  PING: PingPayloadSchema,
  PONG: PongPayloadSchema,
} as const satisfies Partial<Record<MessageName, z.ZodType>>;
