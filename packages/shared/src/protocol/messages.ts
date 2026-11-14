// @contract protocol/messages v1
// @consumers packages/protocol (codecs), apps/client/src/net, apps/server/src/net, apps/server/src/ops (bytes-out
//   counters per message type), tools/bots
//
// THE single message catalog: every message name, its channel, direction and wire id. Specification:
// docs/architecture/netcode.md section 4.1 (client -> server), 4.2 (server -> client, bytes) and 4.3 (server ->
// client, control). Written before any codec; codecs in packages/protocol are generated against this file and never
// invent an id.
//
// Rules:
// - An id, once listed here, is never reused for another message. Removing or renumbering one is a breaking change:
//   bump PROTOCOL_VERSION and add a migration note (module-boundaries.md section 2, contract change process).
// - Bytes ids are one u8 space shared by both directions. Allocation convention of this catalog (see
//   BYTES_ID_RANGES): 0x00 is never assigned (an all-zero buffer must not decode as a message), 0x01-0x1f client ->
//   server, 0x20-0x3f server -> client, 0x70-0x7f M0 spike payloads. Everything else is unassigned.
// - Control ids are the Colyseus message type strings passed to `room.send(type, payload)`.
// - Schema state (netcode.md section 4.4, `ShiftState`) is not a message and has no entry here.
// - v1 (M1-W0-T02, PROTOCOL_VERSION 1) gives every MVP entry an `active` payload contract (./payloads, ./frame, the
//   dust payloads of ../world). `reserved` entries are post-MVP (building, teleport, beacons, chat, extra roles,
//   structures, roster markers): id, direction and channel are frozen, the payload lands with their feature.
// - v1 adds two entries that are not in the netcode.md tables [R]: SELECT_TOOL (c2s `select_tool`) and SIM_EVENTS
//   (s2c `sim_events`). Migration note v0 to v1: PROTOCOL_VERSION 0 to 1 (strict equality, so v0 clients are refused
//   with 4100); ids of v0 entries are unchanged; HELLO, PING and PONG payloads are unchanged.
// - Rates and sizes are quoted per entry from the netcode tables as documentation; the numbers that code needs in
//   M0 are constants in ./payloads.

import { Channel, Direction } from "./channels";

/**
 * Wire protocol version. Bumped on any wire-incompatible change (bytes layout, Schema fields, control payload);
 * see netcode.md section 13. The client sends it in the join options and the server's `onAuth` rejects a mismatch
 * with close code 4100; `/healthz` exposes the server's value.
 */
export const PROTOCOL_VERSION = 1;

/** Lifecycle of a catalog entry in this protocol version. */
export const MessageStatus = {
  /** The payload contract exists in this version (./payloads, ./frame, ../world). */
  Active: "active",
  /** Id, direction and channel are frozen; the payload contract lands in a later contracts wave. */
  Reserved: "reserved",
  /** M0 netcode spike only (`LoadTestRoom`, enabled by `NET_SPIKE=1`); never sent by a production room. */
  Spike: "spike",
} as const;
export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus];

/**
 * Documented send rate of a message (netcode.md sections 4 and 11). `tick` = SIM_TICK_HZ, `snapshot` = SNAPSHOT_HZ,
 * `limited` = on demand with a per-connection token bucket (./limits RATE_LIMITS), `interval` = fixed cadence in
 * seconds, `reply` = answers one request, `event` = on a server event, `once` = once per session.
 */
export type MessageRate =
  | { readonly kind: "tick" }
  | { readonly kind: "snapshot" }
  | { readonly kind: "interval"; readonly seconds: number }
  | { readonly kind: "limited"; readonly perSecond: number; readonly burst: number }
  | { readonly kind: "reply" }
  | { readonly kind: "event" }
  | { readonly kind: "once" };

/** A message on the bytes channel. `id` is the first byte of the message. */
export interface BytesMessageDef {
  readonly channel: typeof Channel.Bytes;
  readonly direction: Direction;
  /** u8 message type id, 0x01-0xff. */
  readonly id: number;
  readonly status: MessageStatus;
  readonly rate: MessageRate;
}

/** A message on the control channel. `id` is the Colyseus message type string. */
export interface ControlMessageDef {
  readonly channel: typeof Channel.Control;
  readonly direction: Direction;
  /** Colyseus message type, lower_snake_case. */
  readonly id: string;
  readonly status: MessageStatus;
  readonly rate: MessageRate;
}

export type MessageDef = BytesMessageDef | ControlMessageDef;

/** Inclusive id blocks of the bytes channel (allocation convention of this catalog). */
export const BYTES_ID_RANGES = {
  clientToServer: { min: 0x01, max: 0x1f },
  serverToClient: { min: 0x20, max: 0x3f },
  /** Reserved for the M0 netcode spike (either direction). */
  spike: { min: 0x70, max: 0x7f },
} as const;

const BYTES = Channel.Bytes;
const CONTROL = Channel.Control;
const C2S = Direction.ClientToServer;
const S2C = Direction.ServerToClient;
const ACTIVE = MessageStatus.Active;
const RESERVED = MessageStatus.Reserved;
const SPIKE = MessageStatus.Spike;

const TICK = { kind: "tick" } as const;
const SNAPSHOT = { kind: "snapshot" } as const;
const REPLY = { kind: "reply" } as const;
const EVENT = { kind: "event" } as const;
const ONCE = { kind: "once" } as const;
const limited = (perSecond: number, burst: number) => ({ kind: "limited", perSecond, burst }) as const;

export const MESSAGE_CATALOG = {
  // ---- Client -> server, bytes (netcode.md section 4.1) -------------------------------------------------------

  /** Per-tick player input, 1-2 inputs per message. Rate: SIM_TICK_HZ while visible. 1 + 1 + 10n B (n <= 2). */
  INPUT: { channel: BYTES, direction: C2S, id: 0x01, status: ACTIVE, rate: TICK },
  /** Clock probe and keep-alive. Rate: every 2 s, also while the tab is hidden. 5 B. */
  PING: { channel: BYTES, direction: C2S, id: 0x02, status: ACTIVE, rate: { kind: "interval", seconds: 2 } },
  /** Request ledgers or stroke logs for <= 8 plots or one chunk (WDS section 5.1). Rate: <= 1 per 2 s. <= 34 B. */
  DUST_REQUEST: { channel: BYTES, direction: C2S, id: 0x03, status: ACTIVE, rate: limited(0.5, 1) },

  // ---- Client -> server, control (netcode.md section 4.1) -----------------------------------------------------

  /** Sent once after the blocking join snapshot is applied. */
  READY: { channel: CONTROL, direction: C2S, id: "ready", status: ACTIVE, rate: ONCE },
  /** Tab hidden / shown. Rate: <= 1/s. */
  VISIBILITY: { channel: CONTROL, direction: C2S, id: "visibility", status: ACTIVE, rate: limited(1, 1) },
  /** Dust residency radius of the client's preset. Rate: on join and on preset change, <= 1 per 5 s. */
  DUST_INTEREST: { channel: CONTROL, direction: C2S, id: "dust_interest", status: ACTIVE, rate: limited(0.2, 1) },
  /** Buy an item; idempotent by requestId. On demand. */
  PURCHASE: { channel: CONTROL, direction: C2S, id: "purchase", status: ACTIVE, rate: limited(5, 5) },
  /**
   * Direct holster selection (slot 0-5). Added by M1-W0-T02 [R], not in the netcode tables: the `holsterNext` and
   * `holsterPrev` bits alone cannot jump several slots in one tick. Counted in the control bucket.
   */
  SELECT_TOOL: { channel: CONTROL, direction: C2S, id: "select_tool", status: ACTIVE, rate: limited(10, 20) },
  /** Place a build piece. On demand. Post-MVP (no Assembly Gun in the MVP). */
  BUILD_PLACE: { channel: CONTROL, direction: C2S, id: "build_place", status: RESERVED, rate: limited(10, 10) },
  /** Move or rotate a placed structure. On demand. */
  BUILD_SHIFT: { channel: CONTROL, direction: C2S, id: "build_shift", status: RESERVED, rate: limited(10, 10) },
  /** Reclaim a placed structure. On demand. */
  BUILD_RECLAIM: { channel: CONTROL, direction: C2S, id: "build_reclaim", status: RESERVED, rate: limited(10, 10) },
  /** Teleport between visited outposts. On demand. Post-MVP (Survey Globe and Relay Pads are cut). */
  RELAY_TELEPORT: { channel: CONTROL, direction: C2S, id: "relay_teleport", status: RESERVED, rate: limited(10, 20) },
  /** Set or clear one of the 12 beacons. Rate: <= 1/s. Post-MVP. */
  BEACON_SET: { channel: CONTROL, direction: C2S, id: "beacon_set", status: RESERVED, rate: limited(1, 1) },
  /** Quick-chat phrase (enum, no free text). Rate: <= 1/s, burst 3. Post-MVP. */
  QUICK_CHAT: { channel: CONTROL, direction: C2S, id: "quick_chat", status: RESERVED, rate: limited(1, 3) },
  /** Ping marker on a plot. Rate: <= 1/s. Post-MVP. */
  PING_MARKER: { channel: CONTROL, direction: C2S, id: "ping_marker", status: RESERVED, rate: limited(1, 3) },
  /** Holder only: permissions of the `temp` role. Post-MVP (no Temps). */
  SET_PERMISSIONS: {
    channel: CONTROL,
    direction: C2S,
    id: "set_permissions",
    status: RESERVED,
    rate: limited(10, 20),
  },
  /** Holder only: appoint a member as supervisor or staff. Post-MVP (MVP roles: Holder and Staff by invite). */
  APPOINT_ROLE: { channel: CONTROL, direction: C2S, id: "appoint_role", status: RESERVED, rate: limited(10, 20) },
  /** Holder only: change the live room's shift type (solo / private in the MVP). */
  SET_SHIFT_TYPE: { channel: CONTROL, direction: C2S, id: "set_shift_type", status: ACTIVE, rate: limited(10, 20) },
  /** Holder: kick a player. (Supervisor kick arrives with the Supervisor role.) */
  KICK: { channel: CONTROL, direction: C2S, id: "kick", status: ACTIVE, rate: limited(10, 20) },
  /** Holder, or supervisor for a 24 h ban: ban a player. Post-MVP. */
  BAN: { channel: CONTROL, direction: C2S, id: "ban", status: RESERVED, rate: limited(10, 20) },
  /** Staff vote to kick a `temp` player when no holder or supervisor is online. Post-MVP. */
  VOTE_KICK: { channel: CONTROL, direction: C2S, id: "vote_kick", status: RESERVED, rate: limited(10, 20) },
  /** Report a player. Rate: <= 1 per 60 s. Post-MVP. */
  REPORT_PLAYER: { channel: CONTROL, direction: C2S, id: "report_player", status: RESERVED, rate: limited(1 / 60, 1) },

  // ---- Server -> client, bytes (netcode.md section 4.2) -------------------------------------------------------

  /** Per-client frame: header, Self, entity and dust sections, events. Rate: SNAPSHOT_HZ. 120-600 B, cap 1,000 B. */
  FRAME: { channel: BYTES, direction: S2C, id: 0x20, status: ACTIVE, rate: SNAPSHOT },
  /** Sliced dust join snapshot (WDS section 5.4). On join, hidden-tab return and resync. */
  DUST_SNAPSHOT: { channel: BYTES, direction: S2C, id: 0x21, status: ACTIVE, rate: EVENT },
  /** One plot's ledger, deflated (WDS section 5.1). On dust-radius entry and on DUST_REQUEST. */
  DUST_LEDGER: { channel: BYTES, direction: S2C, id: 0x22, status: ACTIVE, rate: EVENT },
  /** One plot's stroke log as chains (WDS section 5.1). Within 60 m on entry and on DUST_REQUEST. */
  DUST_LOG: { channel: BYTES, direction: S2C, id: 0x23, status: ACTIVE, rate: EVENT },
  /** Chunk hashes, or per-plot hashes of one chunk (WDS sections 5.1 and 5.5). Rate: 0.2 Hz. */
  DUST_CHECK: { channel: BYTES, direction: S2C, id: 0x24, status: ACTIVE, rate: { kind: "interval", seconds: 5 } },
  /** Deflated structure records of one chunk. On chunk entering structure range. 0.1-4 KB. Post-MVP. */
  STRUCTURES_CHUNK: { channel: BYTES, direction: S2C, id: 0x25, status: RESERVED, rate: EVENT },
  /** Players and robots outside entity interest (Survey Globe markers). Rate: 1 Hz. 10-200 B. Post-MVP. */
  ROSTER_MARKERS: {
    channel: BYTES,
    direction: S2C,
    id: 0x26,
    status: RESERVED,
    rate: { kind: "interval", seconds: 1 },
  },
  /** Reply to PING. 9 B. */
  PONG: { channel: BYTES, direction: S2C, id: 0x27, status: ACTIVE, rate: REPLY },

  // ---- Server -> client, control (netcode.md section 4.3) -----------------------------------------------------

  /**
   * First message the server sends after a successful join: the session parameters. It is NOT the version check
   * (that is the join options + `onAuth`, netcode.md section 13). Added by M0-W0-T01; not in the netcode tables.
   */
  HELLO: { channel: CONTROL, direction: S2C, id: "hello", status: ACTIVE, rate: ONCE },
  /** Reply to `purchase`. */
  PURCHASE_RESULT: { channel: CONTROL, direction: S2C, id: "purchase_result", status: ACTIVE, rate: REPLY },
  /** Reply to `build_place`, `build_shift` and `build_reclaim`. Post-MVP. */
  BUILD_RESULT: { channel: CONTROL, direction: S2C, id: "build_result", status: RESERVED, rate: REPLY },
  /** Reply to `relay_teleport`. Post-MVP. */
  TELEPORT_RESULT: { channel: CONTROL, direction: S2C, id: "teleport_result", status: RESERVED, rate: REPLY },
  /** Rejected control message or rate limit (`RATE_LIMITED`, `FORBIDDEN`, `INVALID`). */
  ERROR: { channel: CONTROL, direction: S2C, id: "error", status: ACTIVE, rate: EVENT },
  /** SIGTERM drain announcement. */
  SHUTDOWN_NOTICE: { channel: CONTROL, direction: S2C, id: "shutdown_notice", status: ACTIVE, rate: EVENT },
  /** Sent just before close 4102 / 4103. */
  KICK_NOTICE: { channel: CONTROL, direction: S2C, id: "kick_notice", status: ACTIVE, rate: EVENT },
  /** Vote kick opened, updated or resolved. Post-MVP. */
  VOTE_KICK_STATE: { channel: CONTROL, direction: S2C, id: "vote_kick_state", status: RESERVED, rate: EVENT },
  /** Holder appointed or demoted a member (also mirrored in Schema). Post-MVP. */
  ROLE_CHANGED: { channel: CONTROL, direction: S2C, id: "role_changed", status: RESERVED, rate: EVENT },
  /** Holder changed the live room's shift type. */
  SHIFT_TYPE_CHANGED: { channel: CONTROL, direction: S2C, id: "shift_type_changed", status: ACTIVE, rate: EVENT },
  /** Reply to `report_player`. Post-MVP. */
  REPORT_ACK: { channel: CONTROL, direction: S2C, id: "report_ack", status: RESERVED, rate: REPLY },
  /** Admission control started refusing new joins (netcode.md section 15). */
  CAPACITY_NOTICE: { channel: CONTROL, direction: S2C, id: "capacity_notice", status: ACTIVE, rate: EVENT },
  /**
   * Batched RoomSim events for a remote client (everything in `SimEventMap` except `dust.collected`, which a client
   * derives from Self `cellGrams` and the stroke echoes). Added by M1-W0-T02 [R], not in the netcode tables. Sent on
   * frame ticks, only when non-empty, so it adds no traffic while nothing happens. A Solo host delivers the same
   * events through `RoomHost.onEvent` without this message.
   */
  SIM_EVENTS: { channel: CONTROL, direction: S2C, id: "sim_events", status: ACTIVE, rate: SNAPSHOT },

  // ---- M0 netcode spike, bytes (LoadTestRoom, M0-W2-T03; netcode.md sections 4.1 and 15) ----------------------
  // Only the ids are reserved here. The synthetic layouts are defined and documented by M0-W2-T03; they mimic the
  // sizes of INPUT, FRAME and the dust sections without claiming those production ids.

  /** Synthetic per-tick input. */
  SPIKE_INPUT: { channel: BYTES, direction: C2S, id: 0x70, status: SPIKE, rate: TICK },
  /** Synthetic per-client frame, sent every snapshot. */
  SPIKE_FRAME: { channel: BYTES, direction: S2C, id: 0x71, status: SPIKE, rate: SNAPSHOT },
  /** Synthetic dust delta, sent every 4th tick. */
  SPIKE_DUST: { channel: BYTES, direction: S2C, id: 0x72, status: SPIKE, rate: SNAPSHOT },
} as const satisfies Record<string, MessageDef>;

/** Every catalog key, for example `"PING"` or `"PURCHASE_RESULT"`. */
export type MessageName = keyof typeof MESSAGE_CATALOG;

type NamesOnChannel<C extends Channel> = {
  [K in MessageName]: (typeof MESSAGE_CATALOG)[K]["channel"] extends C ? K : never;
}[MessageName];

/** Catalog keys of the bytes channel. */
export type BytesMessageName = NamesOnChannel<typeof Channel.Bytes>;

/** Catalog keys of the control channel. */
export type ControlMessageName = NamesOnChannel<typeof Channel.Control>;
