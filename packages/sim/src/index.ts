// Public barrel of @moon-cleanup/sim: the deterministic RoomSim (shared/sim/room-sim v1) and its parts.
// Environment-agnostic (no DOM, Node, three.js or Colyseus): runs in the Solo Web Worker and on the server.
export * from "./config/sim-config";
export * from "./math/trig";
export * from "./math/quantize";
export * from "./dust/ledger-port";
export * from "./dust/room-ledger";
export * from "./clock/sun-clock";
export * from "./movement";
export * from "./tools";
export * from "./cargo";
export * from "./economy";
export * from "./vehicles";
export {
  BOREAL_STAND_IN_OUTPOSTS,
  HopReadout,
  LampReadout,
  MoonRoomSim,
  OutpostReadout,
  PlotCardData,
  type MoonRoomSimOptions,
  type SimOutpost,
  type SimWorld,
} from "./room/moon-room-sim";
export { landingApronPlots } from "./room/landing-apron";
export {
  SIM_CHECKPOINT_META_MAX_BYTES,
  SIM_CHECKPOINT_META_VERSION,
  SIM_CHECKPOINT_PLAYERS_MAX_BYTES,
  SIM_CHECKPOINT_PLAYERS_VERSION,
  simCheckpointPlayerRecordBytes,
  simCheckpointPlayersBytes,
  type SimCheckpoint,
  type SimRestoreRejectCode,
  type SimRestoreResult,
} from "./room/checkpoint";
