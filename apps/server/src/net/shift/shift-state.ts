// Colyseus Schema of `ShiftState` (contract protocol/shift-state-schema v1, netcode.md section 4.4). Field ORDER is
// the wire contract (Schema field indexes follow declaration order): it mirrors SHIFT_STATE_SCHEMA_FIELDS and a test
// compares names and types. Encode once for all clients: no StateView, patches only on frame ticks.
//
// Nested record layouts (PlayerInfo, VehicleInfo, Beacon, Permissions) are not in the v1 contract table; they follow
// the zod shapes of shared sim/shift-state in declaration order (proposal recorded in the M1-W4-T02 report).

import { ArraySchema, MapSchema, schema, t } from "@colyseus/schema";

export const BeaconState = schema({ plotId: t.uint32(), active: t.boolean() }, "Beacon");
export type BeaconState = InstanceType<typeof BeaconState>;

export const PlayerInfoState = schema(
  {
    playerId: t.string(),
    displayName: t.string(),
    slot: t.uint8(),
    role: t.string(),
    tenureLevel: t.uint16(),
    equippedCosmetics: t.array("string"),
    connected: t.boolean(),
    afk: t.boolean(),
    hidden: t.boolean(),
    toolsOwned: t.uint8(),
    equippedTool: t.uint8(),
    vehicleIds: t.array("string"),
  },
  "PlayerInfo",
);
export type PlayerInfoState = InstanceType<typeof PlayerInfoState>;

export const VehicleInfoState = schema(
  {
    entityId: t.uint32(),
    type: t.string(),
    ownerPlayerId: t.string(),
    upgrades: t.map("uint8"),
    occupied: t.boolean(),
  },
  "VehicleInfo",
);
export type VehicleInfoState = InstanceType<typeof VehicleInfoState>;

export const PermissionsState = schema(
  { tempCanBuild: t.boolean(), tempCanSpendShared: t.boolean(), tempCanDriveShared: t.boolean() },
  "Permissions",
);
export type PermissionsState = InstanceType<typeof PermissionsState>;

export const ShiftStateSchemaClass = schema(
  {
    contractId: t.string(),
    shiftType: t.string(),
    protocolVersion: t.uint16(),
    simTickHz: t.uint8(),
    snapshotHz: t.uint8(),
    walletLumens: t.float64(),
    shinePolished: t.uint32(),
    plotCount: t.uint32(),
    sharedUpgrades: t.map("uint8"),
    suitGear: t.map("uint8"),
    visitedOutposts: t.uint8(),
    beacons: t.array(BeaconState),
    players: t.map(PlayerInfoState),
    vehicles: t.map(VehicleInfoState),
    robotCounts: t.map("uint16"),
    permissions: t.ref(PermissionsState),
    fulfilled: t.boolean(),
  },
  "ShiftState",
);
export type ShiftStateSchemaClass = InstanceType<typeof ShiftStateSchemaClass>;

/** Schema type names per top-level field, in declaration order (the contract test compares this table). */
export const SHIFT_STATE_CLASS_FIELDS = [
  ["contractId", "string"],
  ["shiftType", "string"],
  ["protocolVersion", "uint16"],
  ["simTickHz", "uint8"],
  ["snapshotHz", "uint8"],
  ["walletLumens", "float64"],
  ["shinePolished", "uint32"],
  ["plotCount", "uint32"],
  ["sharedUpgrades", "map<uint8>"],
  ["suitGear", "map<uint8>"],
  ["visitedOutposts", "uint8"],
  ["beacons", "array<Beacon>"],
  ["players", "map<PlayerInfo>"],
  ["vehicles", "map<VehicleInfo>"],
  ["robotCounts", "map<uint16>"],
  ["permissions", "Permissions"],
  ["fulfilled", "boolean"],
] as const;

export { ArraySchema, MapSchema };
