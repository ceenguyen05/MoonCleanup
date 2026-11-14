// Public barrel of the M0 netcode spike (M0-W2-T03, NET_SPIKE=1 only).
import type { Server } from "@colyseus/core";
import { LOAD_TEST_ROOM_NAME, createLoadTestRoomClass, type LoadTestRoomDeps } from "./load-test-room";

export {
  BYTES_TYPE,
  LOAD_TEST_ROOM_NAME,
  LoadTestRoom,
  MAX_CATCHUP_STEPS,
  SpikeAvatar,
  SpikeState,
  createLoadTestRoomClass,
  type LoadTestRoomDeps,
  type LoopTimings,
  type SpikeRoomStats,
  type SpikeStatsSink,
} from "./load-test-room";
export {
  SPIKE_BODIES_DEFAULT,
  SPIKE_ROBOTS_DEFAULT,
  SPIKE_SNAPSHOT_HZ,
  SPIKE_TICK_HZ,
  SPIKE_VEHICLES,
  SpikeRoomOptionsSchema,
  type SpikeRoomOptions,
} from "./options";
export { InputVerdict, SpikeEngine, type SpikeCounters, type SpikeSink } from "./spike-engine";
export {
  SPIKE_JOIN_PATH,
  SPIKE_JOINS_PER_IP_PER_MIN,
  createSpikeJoinRoute,
  type SpikeJoinResponse,
} from "./spike-join-route";

/** Rooms are filtered by their rates and synthetic sizes, so equal requests share a room. */
export const SPIKE_FILTER_KEYS = ["tickHz", "snapshotHz", "bodies", "robots"] as const;

/** Defines LoadTestRoom on `colyseus` (the caller also mounts createSpikeJoinRoute). */
export function defineLoadTestRoom(colyseus: Server, deps: LoadTestRoomDeps): void {
  colyseus.define(LOAD_TEST_ROOM_NAME, createLoadTestRoomClass(deps)).filterBy([...SPIKE_FILTER_KEYS]);
}
