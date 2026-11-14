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
