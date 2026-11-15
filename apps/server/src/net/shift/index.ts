// Public barrel of the M1 shift room (apps/server/src/net/shift, netcode-engineer).
import type { Server } from "@colyseus/core";
import { SHIFT_ROOM_NAME, createShiftRoomClass, type ShiftRoomDeps } from "./shift-room";

export {
  SHIFT_MAX_CATCHUP_STEPS,
  SHIFT_ROOM_NAME,
  ShiftReservedOptionsSchema,
  ShiftRoom,
  createShiftRoomClass,
  percentiles,
  type ShiftReservedOptions,
  type ShiftRoomDeps,
} from "./shift-room";
export {
  DEFAULT_DUST_RADIUS_M,
  ENTITY_INTEREST_HYSTERESIS_M,
  ENTITY_INTEREST_MAX_M,
  InputVerdict,
  ShiftCore,
  type ShiftCoreOptions,
  type ShiftSink,
} from "./shift-core";
export {
  DUST_STREAM_BYTES_PER_S,
  JOIN_SNAPSHOT_RADIUS_M,
  ShiftDust,
  nodeDeflateRaw,
  type DustSnapshotBuild,
} from "./shift-dust";
export {
  MemoryShiftDustStore,
  SHIFT_CHECKPOINT_INTERVAL_S,
  ShiftDustPersistence,
  type ShiftDustPersistenceLogger,
  type ShiftDustStore,
  type StoredDustChunk,
} from "./shift-persistence";
export { ConsumeKind, INPUT_AHEAD_MAX, InputAccept, InputSequencer, SUBSTITUTE_MAX } from "./input-sequencer";
export { JOIN_TICKET_MAX_LENGTH, JoinTickets, type TicketClaims } from "./join-ticket";
export { SHIFT_STATE_CLASS_FIELDS, ShiftStateSchemaClass } from "./shift-state";
export { TokenBucket } from "./token-bucket";
export {
  SHIFT_JOIN_PATH,
  createShiftJoinRoute,
  reserveShiftSeat,
  type ShiftJoinDeps,
  type ShiftMember,
  type ShiftMembership,
  type ShiftVerifyToken,
} from "./shift-join";

/** Rooms are filtered by Contract: one room per Contract (netcode.md section 9.3). */
export const SHIFT_FILTER_KEYS = ["contractId"] as const;

/** Defines ShiftRoom on `colyseus` (the caller mounts createShiftJoinRoute). */
export function defineShiftRoom(colyseus: Server, deps: ShiftRoomDeps): void {
  colyseus.define(SHIFT_ROOM_NAME, createShiftRoomClass(deps)).filterBy([...SHIFT_FILTER_KEYS]);
}
