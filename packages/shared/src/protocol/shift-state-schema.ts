// @contract protocol/shift-state-schema v1.1
// @consumers apps/server/src/net (builds the Colyseus Schema class from this table; test compares field names and
//   types), apps/client/src/net (RemoteRoomHost: Schema to ShiftStateView conversion), tools/bots
//
// The Colyseus Schema layout of `ShiftState` (netcode.md section 4.4): field name, Schema type and nesting, in
// declaration order (Schema field indexes follow declaration order, so the order is part of the wire contract and
// new fields are only ever appended). The decoded plain shape is sim/shift-state (`ShiftState`). No StateView.
// Patches are sent on frame ticks only (automatic patching disabled), server-only writes.
// v1.1 (M1, additive): appends `nearParcelsCollected` (uint8 bitmask). Appending a Schema field is wire-compatible
// (clients decode by Schema reflection; field indexes of existing fields are unchanged), so PROTOCOL_VERSION stays 1.

import type { ShiftState } from "../sim/shift-state";

/** Colyseus Schema primitive and container types used by ShiftState. */
export type SchemaFieldType =
  | "string"
  | "boolean"
  | "uint8"
  | "uint16"
  | "uint32"
  | "float64"
  | "map<uint8>"
  | "map<uint16>"
  | "array<Beacon>"
  | "map<PlayerInfo>"
  | "map<VehicleInfo>"
  | "Permissions";

export interface SchemaFieldSpec {
  readonly name: keyof ShiftState;
  readonly type: SchemaFieldType;
  /** `static` fields never change after room creation. */
  readonly mutability: "static" | "dynamic";
}

/** Top-level fields of the ShiftState Schema, in declaration order. */
export const SHIFT_STATE_SCHEMA_FIELDS = [
  { name: "contractId", type: "string", mutability: "static" },
  { name: "shiftType", type: "string", mutability: "dynamic" },
  { name: "protocolVersion", type: "uint16", mutability: "static" },
  { name: "simTickHz", type: "uint8", mutability: "static" },
  { name: "snapshotHz", type: "uint8", mutability: "static" },
  { name: "walletLumens", type: "float64", mutability: "dynamic" },
  { name: "shinePolished", type: "uint32", mutability: "dynamic" },
  { name: "plotCount", type: "uint32", mutability: "static" },
  { name: "sharedUpgrades", type: "map<uint8>", mutability: "dynamic" },
  { name: "suitGear", type: "map<uint8>", mutability: "dynamic" },
  { name: "visitedOutposts", type: "uint8", mutability: "dynamic" },
  { name: "beacons", type: "array<Beacon>", mutability: "dynamic" },
  { name: "players", type: "map<PlayerInfo>", mutability: "dynamic" },
  { name: "vehicles", type: "map<VehicleInfo>", mutability: "dynamic" },
  { name: "robotCounts", type: "map<uint16>", mutability: "dynamic" },
  { name: "permissions", type: "Permissions", mutability: "dynamic" },
  { name: "fulfilled", type: "boolean", mutability: "dynamic" },
  // v1.1 append: Near Parcel collected bitmask (bit k = parcel k), set on frame ticks.
  { name: "nearParcelsCollected", type: "uint8", mutability: "dynamic" },
] as const satisfies readonly SchemaFieldSpec[];

/**
 * Keys of the Schema maps. `players` and `vehicles` are keyed by Colyseus `sessionId` and by `String(entityId)`; the
 * decoded ShiftState exposes them as arrays. `sharedUpgrades`, `suitGear` and `robotCounts` are keyed by game-data id.
 */
export const SHIFT_STATE_MAP_KEYS = {
  players: "sessionId",
  vehicles: "entityId",
  sharedUpgrades: "gameDataId",
  suitGear: "gameDataId",
  robotCounts: "gameDataId",
} as const;

/** Expected Schema traffic per client, bytes per second (netcode.md section 4.4). */
export const SHIFT_STATE_BUDGET_BYTES_PER_S = 200;
