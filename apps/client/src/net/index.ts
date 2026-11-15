// Public barrel of apps/client/src/net (netcode-engineer). The composition root (apps/client/src/app) builds the
// session with createNetSession({ httpUrl, wsUrl, clientBuild, events }) and calls `wake()` from the first
// title-screen interaction when `shouldProbe(...)` allows it.
export {
  HELLO_JOIN_PATH,
  PROBE_INTERVAL_MS,
  PROBE_TIMEOUT_MS,
  colyseusConnect,
  createNetSession,
  shouldProbe,
  type ConnectFn,
  type NetSession,
  type NetSessionOptions,
  type ProbeEnvironment,
  type RoomLike,
  type SeatReservation,
} from "./session";
// Remote room session (M1-W4-T01b). Created only for remote rooms, never in solo (ADR-0031).
export {
  CONTRACT_JOIN_PATH,
  DUST_GAP_MAX_RESYNCS,
  DUST_GAP_RESYNC_DELAY_MS,
  DEFAULT_RETRY_AFTER_MS,
  ROOM_SESSION_TICK_MS,
  SEAT_HOLD_MS,
  classifyJoinRefusal,
  colyseusConsume,
  connectionStateOf,
  createRoomSession,
  equippedToolOf,
  retryAfterMs,
  seatHoldReconnectPolicy,
  type AccessTokenSource,
  type ConsumeReservationFn,
  type JoinRefusal,
  type ReconnectPolicy,
  type RoomConnection,
  type RoomSession,
  type RoomSessionHandlers,
  type RoomSessionOptions,
  type RoomSessionStats,
} from "./room-session";
// Online-room client pieces (M1-W4-T04). Constructed only for remote rooms; solo never creates them (ADR-0031).
export { inflateRaw } from "./inflate-raw";
// DustOffload and the inflate worker load on demand (dynamic import in room-session.ts); only types are re-exported here
// so the entry chunk never carries them.
export type { DustOffloadOptions, DustOffloadStats } from "./dust-offload";
export type { InflateJob, InflateResult, InflateWorkerPort } from "./inflate-worker-core";
export { RemoteDust, type RemoteDustOptions, type RemoteDustStats } from "./remote-dust";
export {
  CORRECTION_HALF_LIFE_MS,
  OwnAvatarPredictor,
  PREDICTION_HISTORY,
  PREDICTION_MAX_REPLAY,
  type PredictInput,
  type PredictorStats,
} from "./predictor";
// Guest sign-in token source (M1-W4-T04b): the app loads it in the background sync chunk (`import("../net/guest-auth")`
// keeps the room/protocol code out of that chunk); re-exported here for tests and the future account UI.
export {
  ACCESS_EXPIRY_MARGIN_MS,
  AUTH_TIMEOUT_MS,
  GuestAuth,
  REFRESH_TOKEN_KEY,
  createGuestAuth,
  type GuestAuthOptions,
  type GuestAuthStats,
  type KeyValueStore,
} from "./guest-auth";
