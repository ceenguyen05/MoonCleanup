// @contract protocol/close-codes v0
// @consumers apps/server/src/net, apps/client/src/net, apps/client/src/ui (one message per code), tools/bots
//
// WebSocket close codes owned by this project. Specification: docs/architecture/netcode.md section 12.
//
// - Our codes stay inside CLOSE_CODE_RANGE (4100-4199). Codes below 4100 belong to WebSocket (1000, 1001, 1006) and
//   to Colyseus (4000 consented, 4001 server shutdown); they are not redefined here because their exact values must
//   be checked against the Colyseus 0.18 `CloseCode` enum by the netcode owner (netcode.md section 18, item 1).
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
