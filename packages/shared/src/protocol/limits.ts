// @contract protocol/limits v1
// @consumers apps/server/src/net (rate limiter, admission, seat hold, idle), apps/client/src/net (backoff, wake probe,
//   heartbeat), packages/protocol (size checks), tools/bots, tools/netsim
//
// Numeric limits of netcode.md sections 1 (N4, N8), 5.1, 9.2, 10 and 11, as constants so no consumer hard-codes them.
// Rates other than the two defaults come from env (`SIM_TICK_HZ`, `SNAPSHOT_HZ`); nothing else derives from literals.

/** Free-tier defaults (netcode.md N4). The supported alternative pair is 30 / 15 (paid instance only). */
export const DEFAULT_SIM_TICK_HZ = 20;
export const DEFAULT_SNAPSHOT_HZ = 10;
/** `[simTickHz, snapshotHz]` pairs the codecs and drivers support; `snapshotHz` always divides `simTickHz`. */
export const SUPPORTED_RATE_PAIRS = [
  [20, 10],
  [30, 15],
] as const;

/** A hidden tab receives a Self-only FRAME at this rate (netcode.md section 7). */
export const HIDDEN_FRAME_HZ = 1;

/** Largest client to server message in bytes (uWS `maxPayloadLength`, netcode.md N8). */
export const INBOUND_MAX_BYTES = 2048;
/** Largest server to client bytes message (bigger payloads are sliced, netcode.md N8). */
export const OUTBOUND_MAX_BYTES = 4096;

/** Token bucket of a per-connection stream: refill per second and burst capacity. */
export interface RateLimitSpec {
  readonly perSecond: number;
  readonly burst: number;
}

/** INPUT: refill 1.5 x SIM_TICK_HZ per second, burst 2 x SIM_TICK_HZ (30/s burst 40 at 20 Hz). */
export const INPUT_RATE_LIMIT_FACTORS = { refill: 1.5, burst: 2 } as const;

/** Fixed limits of netcode.md section 11 (excluding INPUT, which derives from the tick rate). */
export const RATE_LIMITS = {
  ping: { perSecond: 2, burst: 2 },
  /** One request per 2 s (world/dust DUST_REQUEST_MIN_INTERVAL_S). */
  dustRequest: { perSecond: 0.5, burst: 1 },
  /** All control messages together. */
  control: { perSecond: 10, burst: 20 },
  purchase: { perSecond: 5, burst: 5 },
  build: { perSecond: 10, burst: 10 },
  quickChat: { perSecond: 1, burst: 3 },
  pingMarker: { perSecond: 1, burst: 3 },
  /** One per 60 s. */
  reportPlayer: { perSecond: 1 / 60, burst: 1 },
  visibility: { perSecond: 1, burst: 1 },
} as const satisfies Record<string, RateLimitSpec>;

/** More than `count` violations inside `windowS` closes the connection with 4104 RATE_LIMITED. */
export const VIOLATION_LIMIT = { count: 50, windowS: 10 } as const;
/** More than `bytesPerSecond` inbound sustained for `sustainedS` closes the connection with 4104. */
export const INBOUND_BYTES_LIMIT = { bytesPerSecond: 8 * 1024, sustainedS: 5 } as const;

/** Seat hold after a non-consented close (netcode.md section 9.2). */
export const SEAT_HOLD_S = 60;
/** Client reconnect backoff in seconds (netcode.md section 9.2). */
export const RECONNECT_BACKOFF_S = [0.5, 1, 2, 4, 8] as const;
/** Lifetime of the single-use join ticket (security.md section 3). */
export const JOIN_TICKET_TTL_S = 30;
/** No non-neutral input for this long sets the roster `afk` flag, then closes with 4107 (netcode.md section 10). */
export const AFK_AFTER_S = 600;
export const IDLE_CLOSE_AFTER_S = 1800;
/** Client PING cadence is `PING_INTERVAL_MS` in ./payloads. Kicked players cannot rejoin for this long. */
export const KICK_REJOIN_BLOCK_S = 15 * 60;
/** After close 4104 the client waits this long before rejoining. */
export const RATE_LIMITED_REJOIN_S = 30;
