// @contract protocol/close-codes v1
// @consumers apps/server/src/net, apps/client/src/net, apps/client/src/ui (one message per code), tools/bots
//
// WebSocket close codes owned by this project. Specification: docs/architecture/netcode.md section 12.
//
// - Our codes stay inside CLOSE_CODE_RANGE (4100-4199). Codes below 4100 belong to WebSocket and to Colyseus.
//   v1 (M1-W0-T02) records them in `FOREIGN_CLOSE_CODES`, VERIFIED on 2026-11-13 against the installed
//   `@colyseus/shared-types@0.18.3` (`build/Protocol.d.ts`, `CloseCode`) and the SDK `@colyseus/sdk@0.18.10`
//   (`build/Room.mjs`); this closes netcode.md section 18 item 1 (the 4002 / 4003 / 4010 rows are new).
// - M0 code uses PROTOCOL_MISMATCH (4100) and ROOM_FULL (4105). The other codes of the section 12 table are listed
//   so that no consumer invents a number; their flows land in later milestones.
// - A code is never reused for another meaning.

export const CloseCode = {
  /**
   * The client's protocol version differs from the server's. Raised by `onAuth` from the join options; carries a
   * `ProtocolMismatchInfo` (./payloads). Client: `update_required` flow (netcode.md section 13).
   */
  PROTOCOL_MISMATCH: 4100,
  /** Access token missing, expired or invalid. Client: refresh, retry once, else re-authenticate. */
  AUTH_INVALID: 4101,
  /** Kicked from the shift. Client: message; rejoin blocked for 15 min. */
  KICKED: 4102,
  /** Banned from the Contract. Client: message; the Contract is hidden from the list. */
  BANNED: 4103,
  /** Too many violations or inbound bytes (netcode.md section 11). Client: message; rejoin after 30 s. */
  RATE_LIMITED: 4104,
  /**
   * The room has no free seat, or the server is at capacity and admission control refuses the join (netcode.md
   * sections 9.3 and 15). One code for both causes ("server full"); the client picks the wording from the join
   * response or `capacity_notice`.
   */
  ROOM_FULL: 4105,
  /** The same player joined the same Contract again; the older connection is closed. */
  DUPLICATE_SESSION: 4106,
  /** No non-neutral input for 30 min. Client: "clocked out for inactivity". */
  IDLE_TIMEOUT: 4107,
  /** The save failed to load (including a newer save format) or the lease was lost. */
  CONTRACT_UNAVAILABLE: 4108,
} as const;
export type CloseCode = (typeof CloseCode)[keyof typeof CloseCode];

/** Inclusive range every close code of this project must stay in. */
export const CLOSE_CODE_RANGE = { min: 4100, max: 4199 } as const;

/**
 * Close codes that are not ours, with their Colyseus 0.18 names. Verified against node_modules (see the header).
 * 4002, 4003 and 4010 are missing from the netcode.md section 12 table; they do not clash with 4100-4199.
 */
export const FOREIGN_CLOSE_CODES = {
  NORMAL_CLOSURE: 1000,
  GOING_AWAY: 1001,
  NO_STATUS_RECEIVED: 1005,
  ABNORMAL_CLOSURE: 1006,
  /** Colyseus: the client left on purpose (`room.leave(true)`). No reconnect. */
  CONSENTED: 4000,
  /** Colyseus: server shutdown (SIGTERM drain). The SDK does not reconnect; our client rejoins with restore. */
  SERVER_SHUTDOWN: 4001,
  /** Colyseus: the room closed the connection because of an error. */
  WITH_ERROR: 4002,
  /** Colyseus SDK: reconnection ran out of retries. */
  FAILED_TO_RECONNECT: 4003,
  /** Colyseus: dev-mode restart or "may try to reconnect". The SDK reconnects. */
  MAY_TRY_RECONNECT: 4010,
} as const;

/**
 * Codes after which the Colyseus 0.18 SDK runs its own reconnection (`Room.mjs`: 1005, 1006, 1001 and 4010). Every
 * other code, including all of ours and 4001, ends the room without SDK reconnection; the client's own flows
 * (netcode.md section 12 "Client behaviour" column) take over.
 */
export const SDK_RECONNECT_CLOSE_CODES = [1005, 1006, 1001, 4010] as const;
