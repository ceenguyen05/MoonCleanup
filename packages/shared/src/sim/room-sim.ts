// @contract sim/room-sim v1
// @consumers packages/sim (implements RoomSim), apps/server/src/sim (fixed-step driver, input sequencer),
//   apps/client/src/sim-host (Solo LocalRoom worker), apps/client/src/gameplay (prediction), tools/bots
//
// Room simulation interface. Specification: docs/architecture/module-boundaries.md sections 2 and 5; netcode.md
// sections 3 and 5; ADR-0031. One deterministic implementation runs in the Solo worker and on the server.
//
// Per tick the HOST (server driver or worker loop) does: for each actor, pick the input by the sequencing rules of
// netcode.md section 5.1 and call `applyInput`; then `applyIntent` for queued control requests (arrival order); then
// `step(dt)`. `applyInput` therefore sets the input the NEXT `step` consumes for that actor; it does not queue by
// tick. Events raised during a step are delivered synchronously to listeners before `step` returns.
//
// `snapshot()` is the COLD path (saves, tests, debug, join keyframe assembly): it may allocate. The per-snapshot-tick
// FRAME encoding must not use it; the hot-path frame source (reused buffers, per-client interest) is not part of this
// v1 contract and is agreed between packages/sim and packages/protocol (see the M1-W0-T02 report, open item 1).

import type { EntityId } from "../ids";
import type { Seconds, Tick } from "../units";
import type { SimEventMap, SimEventName, Unsubscribe } from "../events";
import type { ActorSnapshot, BuildingComponent, CargoComponent, RobotComponent, VehicleComponent } from "./components";
import type { ControlIntent, IntentResult, SimInputCommand } from "./input";
import type { ContractRole, ShiftState } from "./shift-state";
import type { PlayerId } from "../ids";

/** Player slot inside a room, 0 .. MAX_PLAYERS_PER_ROOM-1 (owner cap: 6 players, 2026-11-12). */
export type ActorSlot = number;

/** Maximum players per room (system-overview.md section 2.2). */
export const MAX_PLAYERS_PER_ROOM = 6;

/** A sim event with its name, as `RoomHost.onEvent` and the `sim_events` message carry it. `payload.tick` is set. */
export type RoomSimEvent = {
  [K in SimEventName]: { readonly name: K; readonly payload: SimEventMap[K] };
}[SimEventName];

/** Entity ids and component lists of the room at one tick (cold path). */
export interface RoomSimSnapshot {
  readonly tick: Tick;
  readonly shift: ShiftState;
  readonly actors: readonly ActorSnapshot[];
  readonly vehicles: readonly VehicleComponent[];
  readonly robots: readonly RobotComponent[];
  readonly cargo: readonly CargoComponent[];
  readonly buildings: readonly BuildingComponent[];
  /** Every live entity id, for interest and slot-table tests. */
  readonly entityIds: readonly EntityId[];
}

/** What the host tells the sim when a player takes a seat. */
export interface ActorJoinInfo {
  readonly playerId: PlayerId;
  readonly displayName: string;
  readonly role: ContractRole;
}

/** The authoritative, deterministic room simulation (environment-agnostic). */
export interface RoomSim {
  /** Number of the next tick to run (the tick `step` will produce events for). */
  readonly tick: Tick;
  /** Advances the simulation by one fixed step of `dt` seconds (1 / SIM_TICK_HZ). */
  step(dt: Seconds): void;
  /** Sets the validated input of one actor for the next step (see the file header for sequencing). */
  applyInput(actor: ActorSlot, input: SimInputCommand): void;
  /** Applies a validated control intent of one actor now; purchases return their synchronous outcome. */
  applyIntent(actor: ActorSlot, intent: ControlIntent): IntentResult;
  /** Seats a player in `actor`'s slot (spawn, Standard Issue tools). */
  addActor(actor: ActorSlot, info: ActorJoinInfo): void;
  /** Removes the actor: drops carried cargo, exits the vehicle. */
  removeActor(actor: ActorSlot): void;
  /** Current state for saves, debug and join assembly (cold path, may allocate). */
  snapshot(): RoomSimSnapshot;
  /** Subscribes to simulation events. */
  onEvent(listener: (event: RoomSimEvent) => void): Unsubscribe;
}
