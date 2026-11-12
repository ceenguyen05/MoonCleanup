// @contract protocol/messages v0
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
// - v0 defines payload contracts only for HELLO, PING and PONG (./payloads). Every other entry is `reserved`: its
//   id, direction and channel are frozen, its payload contract lands in a later contracts wave.
// - Rates and sizes are quoted per entry from the netcode tables as documentation; the numbers that code needs in
//   M0 are constants in ./payloads.

import { Channel, Direction } from "./channels";

/**
 * Wire protocol version. Bumped on any wire-incompatible change (bytes layout, Schema fields, control payload);
 * see netcode.md section 13. The client sends it in the join options and the server's `onAuth` rejects a mismatch
 * with close code 4100; `/healthz` exposes the server's value.
 */
export const PROTOCOL_VERSION = 0;

/** Lifecycle of a catalog entry in this protocol version. */
export const MessageStatus = {
  /** The payload contract exists in this version (./payloads). */
  Active: "active",
  /** Id, direction and channel are frozen; the payload contract lands in a later contracts wave. */
  Reserved: "reserved",
  /** M0 netcode spike only (`LoadTestRoom`, enabled by `NET_SPIKE=1`); never sent by a production room. */
  Spike: "spike",
} as const;
export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus];

/** A message on the bytes channel. `id` is the first byte of the message. */
export interface BytesMessageDef {
  readonly channel: typeof Channel.Bytes;
  readonly direction: Direction;
  /** u8 message type id, 0x01-0xff. */
  readonly id: number;
  readonly status: MessageStatus;
}

/** A message on the control channel. `id` is the Colyseus message type string. */
export interface ControlMessageDef {
  readonly channel: typeof Channel.Control;
  readonly direction: Direction;
  /** Colyseus message type, lower_snake_case. */
  readonly id: string;
  readonly status: MessageStatus;
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

export const MESSAGE_CATALOG = {
  // ---- Client -> server, bytes (netcode.md section 4.1) -------------------------------------------------------

  /** Per-tick player input, 1-2 inputs per message. Rate: SIM_TICK_HZ while visible. 1 + 1 + 10n B (n <= 2). */
  INPUT: { channel: BYTES, direction: C2S, id: 0x01, status: RESERVED },
  /** Clock probe and keep-alive. Rate: every 2 s, also while the tab is hidden. 5 B. */
  PING: { channel: BYTES, direction: C2S, id: 0x02, status: ACTIVE },
  /** Request ledgers or stroke logs for <= 8 plots or one chunk (WDS section 5.1). Rate: <= 1 per 2 s. <= 34 B. */
  DUST_REQUEST: { channel: BYTES, direction: C2S, id: 0x03, status: RESERVED },

  // ---- Client -> server, control (netcode.md section 4.1) -----------------------------------------------------

  /** Sent once after the blocking join snapshot is applied. */
  READY: { channel: CONTROL, direction: C2S, id: "ready", status: RESERVED },
  /** Tab hidden / shown. Rate: <= 1/s. */
  VISIBILITY: { channel: CONTROL, direction: C2S, id: "visibility", status: RESERVED },
  /** Dust residency radius of the client's preset. Rate: on join and on preset change, <= 1 per 5 s. */
  DUST_INTEREST: { channel: CONTROL, direction: C2S, id: "dust_interest", status: RESERVED },
  /** Buy an item; idempotent by requestId. On demand. */
  PURCHASE: { channel: CONTROL, direction: C2S, id: "purchase", status: RESERVED },
  /** Place a build piece. On demand. */
  BUILD_PLACE: { channel: CONTROL, direction: C2S, id: "build_place", status: RESERVED },
  /** Move or rotate a placed structure. On demand. */
  BUILD_SHIFT: { channel: CONTROL, direction: C2S, id: "build_shift", status: RESERVED },
  /** Reclaim a placed structure. On demand. */
  BUILD_RECLAIM: { channel: CONTROL, direction: C2S, id: "build_reclaim", status: RESERVED },
  /** Teleport between visited outposts. On demand. */
  RELAY_TELEPORT: { channel: CONTROL, direction: C2S, id: "relay_teleport", status: RESERVED },
  /** Set or clear one of the 12 beacons. Rate: <= 1/s. */
  BEACON_SET: { channel: CONTROL, direction: C2S, id: "beacon_set", status: RESERVED },
  /** Quick-chat phrase (enum, no free text). Rate: <= 1/s, burst 3. */
  QUICK_CHAT: { channel: CONTROL, direction: C2S, id: "quick_chat", status: RESERVED },
  /** Ping marker on a plot. Rate: <= 1/s. */
  PING_MARKER: { channel: CONTROL, direction: C2S, id: "ping_marker", status: RESERVED },
  /** Holder only: permissions of the `temp` role. */
  SET_PERMISSIONS: { channel: CONTROL, direction: C2S, id: "set_permissions", status: RESERVED },
  /** Holder only: appoint a member as supervisor or staff. */
  APPOINT_ROLE: { channel: CONTROL, direction: C2S, id: "appoint_role", status: RESERVED },
  /** Holder only: change the live room's shift type (solo / private / open). */
  SET_SHIFT_TYPE: { channel: CONTROL, direction: C2S, id: "set_shift_type", status: RESERVED },
  /** Holder or supervisor: kick a player. */
  KICK: { channel: CONTROL, direction: C2S, id: "kick", status: RESERVED },
  /** Holder, or supervisor for a 24 h ban: ban a player. */
  BAN: { channel: CONTROL, direction: C2S, id: "ban", status: RESERVED },
  /** Staff vote to kick a `temp` player when no holder or supervisor is online. */
  VOTE_KICK: { channel: CONTROL, direction: C2S, id: "vote_kick", status: RESERVED },
  /** Report a player. Rate: <= 1 per 60 s. */
  REPORT_PLAYER: { channel: CONTROL, direction: C2S, id: "report_player", status: RESERVED },

  // ---- Server -> client, bytes (netcode.md section 4.2) -------------------------------------------------------

  /** Per-client frame: header, Self, entity and dust sections, events. Rate: SNAPSHOT_HZ. 120-600 B, cap 1,000 B. */
  FRAME: { channel: BYTES, direction: S2C, id: 0x20, status: RESERVED },
  /** Sliced dust join snapshot (WDS section 5.4). On join, hidden-tab return and resync. */
  DUST_SNAPSHOT: { channel: BYTES, direction: S2C, id: 0x21, status: RESERVED },
  /** One plot's ledger, deflated (WDS section 5.1). On dust-radius entry and on DUST_REQUEST. */
  DUST_LEDGER: { channel: BYTES, direction: S2C, id: 0x22, status: RESERVED },
  /** One plot's stroke log as chains (WDS section 5.1). Within 60 m on entry and on DUST_REQUEST. */
  DUST_LOG: { channel: BYTES, direction: S2C, id: 0x23, status: RESERVED },
  /** Chunk hashes, or per-plot hashes of one chunk (WDS sections 5.1 and 5.5). Rate: 0.2 Hz. */
  DUST_CHECK: { channel: BYTES, direction: S2C, id: 0x24, status: RESERVED },
  /** Deflated structure records of one chunk. On chunk entering structure range. 0.1-4 KB. */
  STRUCTURES_CHUNK: { channel: BYTES, direction: S2C, id: 0x25, status: RESERVED },
  /** Players and robots outside entity interest (Survey Globe markers). Rate: 1 Hz. 10-200 B. */
  ROSTER_MARKERS: { channel: BYTES, direction: S2C, id: 0x26, status: RESERVED },
  /** Reply to PING. 9 B. */
  PONG: { channel: BYTES, direction: S2C, id: 0x27, status: ACTIVE },

  // ---- Server -> client, control (netcode.md section 4.3) -----------------------------------------------------

  /**
   * First message the server sends after a successful join: the session parameters. It is NOT the version check
   * (that is the join options + `onAuth`, netcode.md section 13). Added by M0-W0-T01; not in the netcode tables.
   */
  HELLO: { channel: CONTROL, direction: S2C, id: "hello", status: ACTIVE },
  /** Reply to `purchase`. */
  PURCHASE_RESULT: { channel: CONTROL, direction: S2C, id: "purchase_result", status: RESERVED },
  /** Reply to `build_place`, `build_shift` and `build_reclaim`. */
  BUILD_RESULT: { channel: CONTROL, direction: S2C, id: "build_result", status: RESERVED },
  /** Reply to `relay_teleport`. */
  TELEPORT_RESULT: { channel: CONTROL, direction: S2C, id: "teleport_result", status: RESERVED },
  /** Rejected control message or rate limit (`RATE_LIMITED`, `FORBIDDEN`, `INVALID`). */
  ERROR: { channel: CONTROL, direction: S2C, id: "error", status: RESERVED },
  /** SIGTERM drain announcement. */
  SHUTDOWN_NOTICE: { channel: CONTROL, direction: S2C, id: "shutdown_notice", status: RESERVED },
  /** Sent just before close 4102 / 4103. */
  KICK_NOTICE: { channel: CONTROL, direction: S2C, id: "kick_notice", status: RESERVED },
  /** Vote kick opened, updated or resolved. */
  VOTE_KICK_STATE: { channel: CONTROL, direction: S2C, id: "vote_kick_state", status: RESERVED },
  /** Holder appointed or demoted a member (also mirrored in Schema). */
  ROLE_CHANGED: { channel: CONTROL, direction: S2C, id: "role_changed", status: RESERVED },
  /** Holder changed the live room's shift type. */
  SHIFT_TYPE_CHANGED: { channel: CONTROL, direction: S2C, id: "shift_type_changed", status: RESERVED },
  /** Reply to `report_player`. */
  REPORT_ACK: { channel: CONTROL, direction: S2C, id: "report_ack", status: RESERVED },
  /** Admission control started refusing new joins (netcode.md section 15). */
  CAPACITY_NOTICE: { channel: CONTROL, direction: S2C, id: "capacity_notice", status: RESERVED },

  // ---- M0 netcode spike, bytes (LoadTestRoom, M0-W2-T03; netcode.md sections 4.1 and 15) ----------------------
  // Only the ids are reserved here. The synthetic layouts are defined and documented by M0-W2-T03; they mimic the
  // sizes of INPUT, FRAME and the dust sections without claiming those production ids.

  /** Synthetic per-tick input. */
  SPIKE_INPUT: { channel: BYTES, direction: C2S, id: 0x70, status: SPIKE },
  /** Synthetic per-client frame, sent every snapshot. */
  SPIKE_FRAME: { channel: BYTES, direction: S2C, id: 0x71, status: SPIKE },
  /** Synthetic dust delta, sent every 4th tick. */
  SPIKE_DUST: { channel: BYTES, direction: S2C, id: 0x72, status: SPIKE },
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
