// @contract sim/components v1
// @consumers packages/sim (owns and mutates the live components), packages/protocol (FRAME Self / entity codecs),
//   apps/client/src/{gameplay,animation,visuals,terrain} (read decoded states), apps/server/src/net (interest, slot
//   table), apps/client/src/sim-host, tools/bots
//
// Entity component shapes (module-boundaries.md section 2; netcode.md sections 4.2 and 4.5; animation-spec.md section
// 3.4 proposal P1). Types and constants only. The live sim stores these in its own typed arrays; the readonly shapes
// below are what snapshots, codecs and clients exchange. Positions are moon-centred metres (WDS section 1 axes).

import type { EntityId, PlayerId, PlotId } from "../ids";
import type { Grams, Metres, MetresPerSecond, Radians } from "../units";
import type { ActorSlot } from "./room-sim";

/** Point or vector in the moon-centred frame, metres (or m/s, rad/s for velocities). */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Unit quaternion (x, y, z, w). */
export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/** Position and orientation of an entity. Avatars use `yaw` about local up; vehicles use the quaternion. */
export interface Transform {
  readonly position: Vec3;
  readonly orientation: Quat;
}

// ---- Entity kinds (FRAME slot table) ------------------------------------------------------------------------------

/** Entity kind in the per-client slot table (3 bits, netcode.md section 4.2 SlotChanges). */
export const ENTITY_KINDS = [
  "avatar",
  "vehicle",
  "robot",
  "reserved3",
  "reserved4",
  "reserved5",
  "reserved6",
  "reserved7",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];
export const ENTITY_KIND_CODE = { avatar: 0, vehicle: 1, robot: 2 } as const;

// ---- Avatar -------------------------------------------------------------------------------------------------------

/** Movement state (Self, 5 bits). 5 is reserved (netcode.md lists "anchored"; no MVP meaning). */
export const MOVE_STATES = [
  "grounded",
  "airborne",
  "hopping",
  "seated_driver",
  "seated_passenger",
  "anchored",
] as const;
export type MoveState = (typeof MOVE_STATES)[number];
export const MOVE_STATE_BITS = 5;

/**
 * `AvatarActionState` (6 bits, written only by the sim; animation-spec.md section 3.4). Index = wire code.
 * 33 .. 40 are `emote_1 .. emote_8`; 41 .. 63 reserved.
 */
export const AVATAR_ACTION_STATES = [
  "none",
  "airborne",
  "hop_burst",
  "seated",
  "sweep",
  "trait_detailing",
  "trait_flick",
  "lane_lock",
  "pour_assay",
  "pour_former",
  "form_puck",
  "band_stack",
  "carry_puck",
  "carry_stack",
  "carry_two",
  "throw_windup_puck",
  "throw_windup_stack",
  "throw_release",
  "pickup",
  "drop",
  "pour_back",
  "holster_swap",
  "interact_console",
  "interact_press",
  "build_aim",
  "build_place",
  "build_reclaim",
  "vehicle_enter",
  "vehicle_exit",
  "ballast_on",
  "ballast_toggle",
  "lamp_cycle",
  "on_break",
  "emote_1",
  "emote_2",
  "emote_3",
  "emote_4",
  "emote_5",
  "emote_6",
  "emote_7",
  "emote_8",
] as const;
export type AvatarActionState = (typeof AVATAR_ACTION_STATES)[number];
export const AVATAR_ACTION_STATE_BITS = 6;

/** Avatar flag bits (entity record, 6 bits, netcode.md section 4.5). */
export const AVATAR_FLAG_BIT = { cleaning: 0, hopThrust: 1, lamp: 2, visor: 3, seated: 4, afk: 5 } as const;
export type AvatarFlag = keyof typeof AVATAR_FLAG_BIT;
export const AVATAR_FLAG_BITS = 6;

/** Tool table index width in entity records (4 bits: tools.json has 7 entries). */
export const TOOL_INDEX_BITS = 4;
/** Hop charges width (Self, 3 bits). */
export const HOP_CHARGE_BITS = 3;

/** The player-controlled character. */
export interface AvatarComponent {
  readonly entityId: EntityId;
  readonly slot: ActorSlot;
  readonly playerId: PlayerId;
  readonly position: Vec3;
  readonly velocity: Vec3;
  /** Heading about local up, radians, 0 .. 2 pi. */
  readonly yaw: Radians;
  /** Look pitch, radians, -pi/2 .. pi/2. */
  readonly pitch: Radians;
  readonly moveState: MoveState;
  readonly actionState: AvatarActionState;
  readonly hopCharges: number;
  /** Set flags of AVATAR_FLAG_BIT. */
  readonly flags: number;
  /** Vehicle the avatar sits in, `null` on foot. */
  readonly vehicleId: EntityId | null;
  readonly seat: number;
  /** Plot the avatar stands on (the hint of the next `plotAt`). */
  readonly plotId: PlotId;
}

// ---- Tool and Dust Cell -------------------------------------------------------------------------------------------

/** Equipped tool state of one actor, including its Dust Cell and Lane Lock (WDS section 4.1, game-feel section 3). */
export interface ToolComponent {
  readonly slot: ActorSlot;
  /** Holster slot 0 .. 5 of the equipped tool. */
  readonly holsterSlot: number;
  /** `tool.<id>` of game-data. */
  readonly toolId: string;
  /** Index into the game-data tool table (stroke `toolCode`, entity `toolId`). */
  readonly toolCode: number;
  /** Dust Cell contents, grams. */
  readonly cellGrams: Grams;
  /** Dust Cell capacity, grams. */
  readonly cellCapGrams: Grams;
  readonly sweeping: boolean;
  readonly laneLocked: boolean;
  /** Locked sweep heading, radians; meaningful only while `laneLocked`. */
  readonly laneAngle: Radians;
  /** Aim distance as 0 .. 1 of the tool's reach. */
  readonly aim01: number;
}

// ---- Cargo --------------------------------------------------------------------------------------------------------

/** Cargo kinds: a Dust Puck, or a Puck Stack (bands of pucks). */
export const CARGO_KINDS = ["puck", "stack"] as const;
export type CargoKind = (typeof CARGO_KINDS)[number];

/** A formed Dust Puck or Puck Stack lying in the world or carried. Pucks on Glide Rails (v1.0) are not streamed. */
export interface CargoComponent {
  readonly entityId: EntityId;
  readonly kind: CargoKind;
  /** Pucks in the stack (1 for a puck). */
  readonly count: number;
  readonly grams: Grams;
  readonly position: Vec3;
  /** Actor carrying it, `null` when lying on the ground or on a vehicle. */
  readonly carriedBy: ActorSlot | null;
  /** Vehicle carrying it, `null` otherwise. */
  readonly onVehicle: EntityId | null;
}

// ---- Vehicle ------------------------------------------------------------------------------------------------------

/** Vehicle gear (2 bits in Self, "gear/boost 4 b"): neutral, drive, reverse, throttle locked. */
export const VEHICLE_GEARS = ["neutral", "drive", "reverse", "locked"] as const;
export type VehicleGear = (typeof VEHICLE_GEARS)[number];

/** Vehicle flag bits (entity record flags, 8 bits): lights, boost, intake, hopper level 4 bits at bit 3. */
export const VEHICLE_FLAG_BIT = { lights: 0, boost: 1, intake: 2, hopperLevel: 3 } as const;
export const VEHICLE_HOPPER_LEVEL_BITS = 4;

/** A driven or parked vehicle (Trundle in the MVP). */
export interface VehicleComponent {
  readonly entityId: EntityId;
  /** `vehicle.<id>` of game-data. */
  readonly kindId: string;
  readonly ownerSlot: ActorSlot;
  /** Driver, `null` when parked. */
  readonly driverSlot: ActorSlot | null;
  readonly transform: Transform;
  readonly linearVelocity: Vec3;
  readonly angularVelocity: Vec3;
  /** Steering, -1 .. 1. */
  readonly steer: number;
  readonly speed: MetresPerSecond;
  readonly gear: VehicleGear;
  readonly boosting: boolean;
  readonly lights: boolean;
  readonly intake: boolean;
  /** Hopper fill, 0 .. 15. */
  readonly hopperLevel: number;
}

// ---- Robot --------------------------------------------------------------------------------------------------------

/** The 9 robot UI states (robots.json `states[]`, naming bible), 4 bits on the wire. Index = wire code. */
export const ROBOT_UI_STATES = [
  "foraging",
  "flying",
  "inbound",
  "molting",
  "patch_picked_clean",
  "roost_brimming",
  "crop_full",
  "grounded",
  "resting",
] as const;
export type RobotUiState = (typeof ROBOT_UI_STATES)[number];

/** A robot (Sandpiper in the MVP). Its dust work travels as `robot.plot` intents, not as entity motion. */
export interface RobotComponent {
  readonly entityId: EntityId;
  /** `robot.<id>` of game-data. */
  readonly kindId: string;
  readonly roostId: EntityId | null;
  readonly position: Vec3;
  /** Heading about local up, radians. */
  readonly heading: Radians;
  readonly state: RobotUiState;
  /** Cargo fill, 0 .. 7. */
  readonly cargo: number;
}

// ---- Building (stub) ----------------------------------------------------------------------------------------------

/** Placed structure record (netcode.md section 4.2 STRUCTURES_CHUNK). Stub: no MVP system places or streams these. */
export interface BuildingComponent {
  readonly structureId: number;
  /** `piece.<id>` of game-data. */
  readonly pieceId: string;
  readonly plotId: PlotId;
  /** Plot-local position, centimetres. */
  readonly localCm: readonly [x: number, y: number];
  /** Rotation in 15 degree steps, 0 .. 23. */
  readonly rotStep: number;
  /** Finish index, 0 .. 7 (3 bits). */
  readonly finish: number;
  readonly ownerSlot: ActorSlot;
}

// ---- Snapshot entries ---------------------------------------------------------------------------------------------

/** One connected actor in a `RoomSimSnapshot`. */
export interface ActorSnapshot {
  readonly avatar: AvatarComponent;
  readonly tool: ToolComponent;
  /** Cargo the actor carries. */
  readonly carrying: readonly EntityId[];
}

/** Largest distance from the moon centre the position encodings cover, metres (netcode.md section 2 ranges). */
export const MAX_WORLD_RADIUS_M: Metres = 3276.8;
