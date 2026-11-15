// Public barrel of apps/server/src/net (netcode-engineer): server factory, transport selection, HelloRoom, HTTP/CORS
// adapters. The transport adapters themselves (./uws-transport, ./ws-transport) are NOT re-exported: they are only
// ever loaded lazily through ./transport so the native addon is never imported eagerly.
export {
  DEFAULT_ADMISSION,
  WS_MAX_BACKPRESSURE_BYTES,
  WS_MAX_PAYLOAD_BYTES,
  createGameServer,
  type CreateGameServerOptions,
  type GameServer,
  type GameServerRates,
  type ShiftServerOptions,
} from "./game-server";
export * from "./shift";
export {
  DEFAULT_TRANSPORT_MODE,
  TRANSPORT_MODES,
  TransportModeError,
  defaultTransportLoaders,
  describeLoadFailure,
  loadTransportMode,
  parseTransportMode,
  selectTransport,
  type BoundTransport,
  type TransportDeps,
  type TransportFactory,
  type TransportKind,
  type TransportLoaders,
  type TransportMode,
} from "./transport";
export { createNodeRequestHandler, type NodeRequestHandler } from "./node-http";
export {
  MAX_HTTP_BODY_BYTES,
  mountFallbackRoutes,
  mountHttpRoutes,
  parseQuery,
  routeParamNames,
  safeDecodeURIComponent,
  type NetLogger,
  type RawBodyAuth,
  type RawBodyRefusal,
} from "./http-routes";
export {
  AT_CAPACITY_RETRY_AFTER_S,
  Admission,
  IpRateLimiter,
  MAX_SEATS_PER_IP,
  MAX_SOCKETS_PER_IP,
  ROOM_CREATES_PER_IP_PER_MIN,
  type AdmissionLimits,
  type AdmissionResult,
  type SeatReservation,
} from "./admission";
export {
  CORS_ALLOWED_HEADERS,
  CORS_ALLOWED_METHODS,
  CORS_MAX_AGE_S,
  PUBLIC_CORS_PATHS,
  createOriginPolicy,
  type OriginPolicy,
} from "./cors";
export {
  DEFAULT_CLIENT_IP_HEADER,
  UNKNOWN_CLIENT_IP,
  resolveClientIp,
  resolveUpgradeClientIp,
  sanitizeIp,
} from "./client-ip";
export {
  DEFAULT_IDLE_LIMITS,
  HANDSHAKE_TIMEOUT_MS,
  IdleWatch,
  SILENCE_TIMEOUT_MS,
  type IdleClient,
  type IdleLimits,
} from "./idle-watch";
export { HELLO_ROOM_NAME, HelloRoom, HelloState, assertRates, type HelloRoomOptions } from "./hello-room";
export {
  HELLO_JOIN_PATH,
  ROOM_JOINS_PER_IP_PER_MIN,
  ROOM_JOINS_UNKNOWN_PER_MIN,
  createHelloJoinRoute,
  type HelloJoinResponse,
} from "./hello-join-route";
export {
  LOAD_TEST_ROOM_NAME,
  LoadTestRoom,
  SPIKE_JOIN_PATH,
  SpikeRoomOptionsSchema,
  type LoopTimings,
  type SpikeJoinResponse,
  type SpikeRoomOptions,
  type SpikeRoomStats,
  type SpikeStatsSink,
} from "./spike";
