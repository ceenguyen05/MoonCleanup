// @contract protocol/payloads v1
// @consumers packages/protocol (codecs), apps/client/src/net, apps/client/src/sim-host, apps/server/src/net, tools/bots
//
// Payload contracts of the messages that are `active` (./messages): v0 had HELLO, PING, PONG and the version
// handshake shapes; v1 (M1-W0-T02) adds every MVP client -> server payload (zod schema each, validated at the room
// edge) and the server -> client control payloads, and maps all active entries in PAYLOAD_SCHEMAS. Specification: docs/architecture/netcode.md
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
import { PlayerIdSchema, RequestIdSchema } from "../ids";
import { InputMessageSchema, PurchasePayloadSchema, SelectToolPayloadSchema } from "../sim/input";
import { ContractRoleSchema, MvpShiftTypeSchema, ShiftTypeSchema } from "../sim/shift-state";
import { SIM_EVENT_NAMES, PURCHASE_REJECT_REASONS } from "../events/gameplay";
import type { SimEventMap, SimEventName } from "../events/gameplay";
import {
  DUST_MESSAGE_SLICE_MAX_BYTES,
  DustCheckPayloadSchema,
  DustInterestPayloadSchema,
  DustLedgerPayloadSchema,
  DustLogPayloadSchema,
  DustRequestPayloadSchema,
} from "../world/dust";
import { FramePayloadSchema } from "./frame";

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

// ---- v1: client -> server control payloads ----------------------------------------------------------------------

/** `ready` payload: empty object. */
export const ReadyPayloadSchema = z.object({});
export type ReadyPayload = z.infer<typeof ReadyPayloadSchema>;

/** `visibility` payload: the tab was hidden or shown (netcode.md section 7 hidden-tab rules). */
export const VisibilityPayloadSchema = z.object({ hidden: z.boolean() });
export type VisibilityPayload = z.infer<typeof VisibilityPayloadSchema>;

/** `set_shift_type` payload (Holder only): MVP shift types. The server also requires `solo` only when alone. */
export const SetShiftTypePayloadSchema = z.object({ shiftType: MvpShiftTypeSchema });
export type SetShiftTypePayload = z.infer<typeof SetShiftTypePayloadSchema>;

/** Reason codes of kick and ban (data-model.md section 3.6 `ban_reason`). */
export const MODERATION_REASON_CODES = ["griefing", "harassment", "cheating", "other"] as const;
export const ModerationReasonCodeSchema = z.enum(MODERATION_REASON_CODES);
export type ModerationReasonCode = (typeof MODERATION_REASON_CODES)[number];

/** `kick` payload (Holder; not self; not the Holder). */
export const KickPayloadSchema = z.object({
  playerId: PlayerIdSchema,
  reasonCode: ModerationReasonCodeSchema,
});
export type KickPayload = z.infer<typeof KickPayloadSchema>;

// `purchase` and `select_tool` payloads are the sim/input schemas (PurchasePayloadSchema, SelectToolPayloadSchema);
// `dust_interest` is world/dust DustInterestPayloadSchema.

// ---- v1: server -> client control payloads ----------------------------------------------------------------------

/** `purchase_result`: reply to `purchase`. `code` only when `ok` is false, `walletAfter` only when true. */
export const PurchaseResultPayloadSchema = z.discriminatedUnion("ok", [
  z.object({ requestId: RequestIdSchema, ok: z.literal(true), walletAfter: z.number().min(0) }),
  z.object({ requestId: RequestIdSchema, ok: z.literal(false), code: z.enum(PURCHASE_REJECT_REASONS) }),
]);
export type PurchaseResultPayload = z.infer<typeof PurchaseResultPayloadSchema>;

/** Codes of the `error` message (netcode.md section 4.3). */
export const WIRE_ERROR_CODES = ["RATE_LIMITED", "FORBIDDEN", "INVALID"] as const;
export const WireErrorCodeSchema = z.enum(WIRE_ERROR_CODES);
export type WireErrorCode = (typeof WIRE_ERROR_CODES)[number];

/** `error`: a control message was rejected. `ref` echoes the message type or requestId (<= 40 chars). */
export const ErrorPayloadSchema = z.object({
  code: WireErrorCodeSchema,
  ref: z.string().max(40).optional(),
});
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

/** Reasons of a `shutdown_notice`. */
export const SHUTDOWN_REASONS = ["restart", "deploy"] as const;

/** `shutdown_notice`: SIGTERM drain; the connection closes with 4001 after `secondsUntilClose`. */
export const ShutdownNoticePayloadSchema = z.object({
  reason: z.enum(SHUTDOWN_REASONS),
  secondsUntilClose: z.int().min(0).max(300),
});
export type ShutdownNoticePayload = z.infer<typeof ShutdownNoticePayloadSchema>;

/** `kick_notice`: sent just before close 4102 / 4103. `until` is an ISO instant for timed blocks. */
export const KickNoticePayloadSchema = z.object({
  by: ContractRoleSchema,
  reasonCode: ModerationReasonCodeSchema,
  until: z.iso.datetime().optional(),
});
export type KickNoticePayload = z.infer<typeof KickNoticePayloadSchema>;

/** `shift_type_changed`. */
export const ShiftTypeChangedPayloadSchema = z.object({ shiftType: ShiftTypeSchema });
export type ShiftTypeChangedPayload = z.infer<typeof ShiftTypeChangedPayloadSchema>;

/** `capacity_notice`. */
export const CapacityNoticePayloadSchema = z.object({ reason: z.literal("at_capacity") });
export type CapacityNoticePayload = z.infer<typeof CapacityNoticePayloadSchema>;

/** Sim events that do NOT cross the wire in `sim_events`: the client derives them (see MESSAGE_CATALOG.SIM_EVENTS). */
export const WIRE_EXCLUDED_SIM_EVENTS = ["dust.collected"] as const satisfies readonly SimEventName[];
export type WireSimEventName = Exclude<SimEventName, (typeof WIRE_EXCLUDED_SIM_EVENTS)[number]>;
/** Sim event names carried by `sim_events`, in SIM_EVENT_NAMES order. */
export const WIRE_SIM_EVENT_NAMES: readonly WireSimEventName[] = SIM_EVENT_NAMES.filter(
  (name): name is WireSimEventName => !(WIRE_EXCLUDED_SIM_EVENTS as readonly string[]).includes(name),
);

/** One event on the wire: name plus its `SimEventMap` payload. Payload shape is trusted from the server (msgpack). */
export type WireSimEvent = {
  [K in WireSimEventName]: { readonly name: K; readonly payload: SimEventMap[K] };
}[WireSimEventName];

/** Largest `sim_events` batch per message; more spill to the next frame tick. */
export const SIM_EVENTS_BATCH_MAX = 32;

/**
 * `sim_events`: batched RoomSim events. The client validates the envelope (name in the wire set, payload an object
 * carrying an integer `tick`); the payload fields are the server's `SimEventMap` types.
 */
export const SimEventsPayloadSchema = z.object({
  events: z
    .array(
      z.object({
        name: z.enum(WIRE_SIM_EVENT_NAMES as [WireSimEventName, ...WireSimEventName[]]),
        payload: z.looseObject({ tick: z.int().min(0).max(U32_MAX) }),
      }),
    )
    .min(1)
    .max(SIM_EVENTS_BATCH_MAX),
});
export type SimEventsPayload = { readonly events: readonly WireSimEvent[] };

// ---- v1: bytes payloads (decoded forms) -------------------------------------------------------------------------

/** Decoded `INPUT` bytes message: see sim/input INPUT_WIRE for the layout. */
export { InputMessageSchema as InputPayloadSchema } from "../sim/input";

/**
 * Decoded slice of `DUST_SNAPSHOT` (0x21). Wire: type u8 | sliceIndex u16 | sliceCount u16 | snapshotVersion u32 |
 * deflate bytes; the whole message is at most DUST_MESSAGE_SLICE_MAX_BYTES. The slices concatenate to the deflate
 * stream of the `DustSnapshotPayload` of world/dust.
 */
export const DUST_SNAPSHOT_SLICE_HEADER_BYTES = 1 + 2 + 2 + 4;
export const DustSnapshotSliceSchema = z
  .object({
    sliceIndex: z.int().min(0).max(U16_MAX),
    sliceCount: z.int().min(1).max(U16_MAX),
    snapshotVersion: z.int().min(0).max(U32_MAX),
    data: z
      .instanceof(Uint8Array)
      .refine((bytes) => bytes.length <= DUST_MESSAGE_SLICE_MAX_BYTES - DUST_SNAPSHOT_SLICE_HEADER_BYTES, {
        message: "slice exceeds DUST_MESSAGE_SLICE_MAX_BYTES",
      }),
  })
  .refine((slice) => slice.sliceIndex < slice.sliceCount, { message: "sliceIndex must be below sliceCount" });
export interface DustSnapshotSlice {
  readonly sliceIndex: number;
  readonly sliceCount: number;
  readonly snapshotVersion: number;
  readonly data: Uint8Array;
}

// ---- Payload schema per active catalog entry --------------------------------------------------------------------

/**
 * One zod schema per `active` message of the catalog, keyed by catalog name: the DECODED payload object. A catalog
 * test checks that the keys are exactly the active entries. Bytes messages are decoded by packages/protocol into
 * these shapes; control messages arrive as msgpack objects and are parsed with these schemas at the room edge.
 */
export const PAYLOAD_SCHEMAS = {
  // client -> server
  INPUT: InputMessageSchema,
  PING: PingPayloadSchema,
  DUST_REQUEST: DustRequestPayloadSchema,
  READY: ReadyPayloadSchema,
  VISIBILITY: VisibilityPayloadSchema,
  DUST_INTEREST: DustInterestPayloadSchema,
  PURCHASE: PurchasePayloadSchema,
  SELECT_TOOL: SelectToolPayloadSchema,
  SET_SHIFT_TYPE: SetShiftTypePayloadSchema,
  KICK: KickPayloadSchema,
  // server -> client
  FRAME: FramePayloadSchema,
  DUST_SNAPSHOT: DustSnapshotSliceSchema,
  DUST_LEDGER: DustLedgerPayloadSchema,
  DUST_LOG: DustLogPayloadSchema,
  DUST_CHECK: DustCheckPayloadSchema,
  PONG: PongPayloadSchema,
  HELLO: HelloPayloadSchema,
  PURCHASE_RESULT: PurchaseResultPayloadSchema,
  ERROR: ErrorPayloadSchema,
  SHUTDOWN_NOTICE: ShutdownNoticePayloadSchema,
  KICK_NOTICE: KickNoticePayloadSchema,
  SHIFT_TYPE_CHANGED: ShiftTypeChangedPayloadSchema,
  CAPACITY_NOTICE: CapacityNoticePayloadSchema,
  SIM_EVENTS: SimEventsPayloadSchema,
} as const satisfies Partial<Record<MessageName, z.ZodType>>;
