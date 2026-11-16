// @contract sim/shift-state v1.1
// @consumers apps/server/src/net (Colyseus Schema class built from protocol/shift-state-schema), apps/client/src/net
//   (RemoteRoomHost converts the Schema to this view), apps/client/src/sim-host (LocalRoomHost emits it), apps/client/
//   src/{ui,gameplay} (read), packages/sim (RoomSim.snapshot), apps/server/src/api (shift types and roles in DTOs)
//
// ShiftState: the low-rate shared state of a shift (netcode.md section 4.4). In a server room it travels as a Colyseus
// Schema (field table: protocol/shift-state-schema); in a Solo Shift the worker posts it as a plain `ShiftStateView`
// on change (ADR-0031, netcode.md section 19). This file is the plain, read-only, decoded shape both hosts hand to
// the client. Map-like Schema fields are plain records or arrays here (the Schema adapter converts).
// v1.1 (M1, additive): appends optional `nearParcelsCollected`; no PROTOCOL_VERSION bump.

import { z } from "zod";
import { ContractIdSchema, PlayerIdSchema, PlotIdSchema } from "../ids";
import type { ContractId, PlayerId, PlotId } from "../ids";
import { STROKE_PLAYER_ACTOR_SLOT_MAX } from "../world/stroke";
import type { Lumens, Tick } from "../units";

/** Room types of a Contract (netcode.md section 9.3; data-model.md section 3.5). */
export const SHIFT_TYPES = ["solo", "private", "open"] as const;
export const ShiftTypeSchema = z.enum(SHIFT_TYPES);
export type ShiftType = (typeof SHIFT_TYPES)[number];

/** Shift types available in the MVP: Open Shifts are v1.0 (scope-tiers.md). Control payloads accept only these. */
export const MVP_SHIFT_TYPES = ["solo", "private"] as const;
export const MvpShiftTypeSchema = z.enum(MVP_SHIFT_TYPES);
export type MvpShiftType = (typeof MVP_SHIFT_TYPES)[number];

/** Contract member roles (GDD section 7.5; data-model.md section 3.6). */
export const CONTRACT_ROLES = ["holder", "supervisor", "staff", "temp"] as const;
export const ContractRoleSchema = z.enum(CONTRACT_ROLES);
export type ContractRole = (typeof CONTRACT_ROLES)[number];

/** Roles that exist in the MVP: Holder and Staff. Supervisor and Temp arrive with v1.0 (ui-screens section 11). */
export const MVP_CONTRACT_ROLES = ["holder", "staff"] as const;
export const MvpContractRoleSchema = z.enum(MVP_CONTRACT_ROLES);
export type MvpContractRole = (typeof MVP_CONTRACT_ROLES)[number];

/** Flare Beacon count (netcode.md section 4.4). Beacons are cut from the MVP; the array stays 12 inactive entries. */
export const BEACON_COUNT = 12;

/** Holder-controlled permissions of the `temp` role (data-model.md section 3.5 `temp_permissions`). */
export const PermissionsSchema = z.object({
  tempCanBuild: z.boolean(),
  tempCanSpendShared: z.boolean(),
  tempCanDriveShared: z.boolean(),
});
export type Permissions = z.infer<typeof PermissionsSchema>;

const U8 = z.int().min(0).max(0xff);
const U16 = z.int().min(0).max(0xffff);
const U32 = z.int().min(0).max(0xffff_ffff);
const LevelRecord = z.record(z.string().min(1).max(64), U8);

/** One Flare Beacon slot. */
export const BeaconSchema = z.object({ plotId: PlotIdSchema, active: z.boolean() });
export interface Beacon {
  readonly plotId: PlotId;
  readonly active: boolean;
}

/** Roster entry (`PlayerInfo`, netcode.md section 4.4). */
export const PlayerInfoSchema = z.object({
  playerId: PlayerIdSchema,
  displayName: z.string().min(3).max(20),
  /** Actor slot, 0 .. 15 (stroke format); rooms assign 0 .. MAX_PLAYERS_PER_ROOM - 1. */
  slot: z.int().min(0).max(STROKE_PLAYER_ACTOR_SLOT_MAX),
  role: ContractRoleSchema,
  tenureLevel: U16,
  /** Equipped cosmetic ids (game-data). */
  equippedCosmetics: z.array(z.string().max(64)).max(16),
  connected: z.boolean(),
  afk: z.boolean(),
  hidden: z.boolean(),
  /** Bitmask over the game-data tool table index (bit k = tool k owned). */
  toolsOwned: U8,
  /** Tool table index of the equipped tool. */
  equippedTool: U8,
  /** Owned vehicle ids (`vehicle.trundle`). */
  vehicleIds: z.array(z.string().max(64)).max(16),
});
export interface PlayerInfo {
  readonly playerId: PlayerId;
  readonly displayName: string;
  readonly slot: number;
  readonly role: ContractRole;
  readonly tenureLevel: number;
  readonly equippedCosmetics: readonly string[];
  readonly connected: boolean;
  readonly afk: boolean;
  readonly hidden: boolean;
  readonly toolsOwned: number;
  readonly equippedTool: number;
  readonly vehicleIds: readonly string[];
}

/** Shared vehicle record (`VehicleInfo`). */
export const VehicleInfoSchema = z.object({
  /** Entity id of the vehicle (the FRAME slot table maps it to a slot). */
  entityId: z.int().min(0).max(0xffff_ffff),
  /** `vehicle.<id>` of game-data. */
  type: z.string().min(1).max(64),
  ownerPlayerId: PlayerIdSchema,
  upgrades: LevelRecord,
  occupied: z.boolean(),
});
export interface VehicleInfo {
  readonly entityId: number;
  readonly type: string;
  readonly ownerPlayerId: PlayerId;
  readonly upgrades: Readonly<Record<string, number>>;
  readonly occupied: boolean;
}

/**
 * ShiftState without `tick`: what the Colyseus Schema holds. Static fields (`protocolVersion`, `simTickHz`,
 * `snapshotHz`, `contractId`) never change after the room is created.
 */
export const ShiftStateSchema = z.object({
  contractId: ContractIdSchema,
  shiftType: ShiftTypeSchema,
  protocolVersion: U16,
  simTickHz: U8,
  snapshotHz: U8,
  /** Shared shift wallet (float64 in the Schema). */
  walletLumens: z.number().min(0),
  shinePolished: U32,
  plotCount: U32,
  /** Promotions Board node id (`node.broad_strokes`) to level. */
  sharedUpgrades: LevelRecord,
  /** Suit gear and Dust Cell line id (`gear.holster_rig`, `node.dust_cell_*`) to level. */
  suitGear: LevelRecord,
  /** Relay Pad eligibility bitmask (outposts visited). */
  visitedOutposts: U8,
  beacons: z.array(BeaconSchema).length(BEACON_COUNT),
  players: z.array(PlayerInfoSchema).max(16),
  vehicles: z.array(VehicleInfoSchema).max(64),
  /** Robot type id (`robot.sandpiper`) to count; positions travel in bytes frames. */
  robotCounts: z.record(z.string().min(1).max(64), U16),
  permissions: PermissionsSchema,
  /** Contract Fulfilled. */
  fulfilled: z.boolean(),
  /**
   * v1.1 (additive): Near Parcel collected bitmask, bit k = parcel k of `placeNearParcels(seedOfString(contractId))`
   * collected (k < MVP_SCOPE.nearParcelCount, at most 8). Optional in this revision: server rooms always set it;
   * producers written before v1.1 (sim `snapshot()`, test fixtures) omit it, and consumers treat absent as "unknown"
   * (fall back to their own derivation). Planned: required once every producer sets it (add, migrate, remove).
   */
  nearParcelsCollected: U8.optional(),
});
export interface ShiftState {
  readonly contractId: ContractId;
  readonly shiftType: ShiftType;
  readonly protocolVersion: number;
  readonly simTickHz: number;
  readonly snapshotHz: number;
  readonly walletLumens: Lumens;
  readonly shinePolished: number;
  readonly plotCount: number;
  readonly sharedUpgrades: Readonly<Record<string, number>>;
  readonly suitGear: Readonly<Record<string, number>>;
  readonly visitedOutposts: number;
  readonly beacons: readonly Beacon[];
  readonly players: readonly PlayerInfo[];
  readonly vehicles: readonly VehicleInfo[];
  readonly robotCounts: Readonly<Record<string, number>>;
  readonly permissions: Permissions;
  readonly fulfilled: boolean;
  /** v1.1: Near Parcel collected bitmask (bit k = parcel k); absent from pre-v1.1 producers. */
  readonly nearParcelsCollected?: number;
}

/** `ShiftState` stamped with the sim tick it was captured on: the `RoomHost.onShiftState` payload (ADR-0031). */
export const ShiftStateViewSchema = ShiftStateSchema.extend({ tick: U32 });
export interface ShiftStateView extends ShiftState {
  readonly tick: Tick;
}
