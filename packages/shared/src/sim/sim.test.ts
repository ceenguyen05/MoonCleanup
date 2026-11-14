import { describe, expect, expectTypeOf, it } from "vitest";
import {
  AVATAR_ACTION_STATES,
  AVATAR_FLAG_BIT,
  CARGO_KINDS,
  ENTITY_KINDS,
  MOVE_STATES,
  ROBOT_UI_STATES,
  VEHICLE_GEARS,
  type AvatarComponent,
  type ToolComponent,
} from "./components";
import {
  BEACON_COUNT,
  CONTRACT_ROLES,
  MVP_CONTRACT_ROLES,
  MVP_SHIFT_TYPES,
  PermissionsSchema,
  SHIFT_TYPES,
  ShiftStateSchema,
  ShiftStateViewSchema,
  type ShiftState,
  type ShiftStateView,
} from "./shift-state";
import { MAX_PLAYERS_PER_ROOM, type RoomSim, type RoomSimEvent } from "./room-sim";
import { SIM_EVENT_NAMES, type SimEventMap } from "../events";
import type { Tick } from "../units";

const PLAYER = "0190a6c4-7d3e-7b1a-9c55-2f8e4d6a1b01";
const CONTRACT = "0190a6c4-7d3e-7b1a-9c55-2f8e4d6a1b00";

const beacons = Array.from({ length: BEACON_COUNT }, () => ({ plotId: 0, active: false }));
const state = {
  contractId: CONTRACT,
  shiftType: "private",
  protocolVersion: 1,
  simTickHz: 20,
  snapshotHz: 10,
  walletLumens: 1234.5,
  shinePolished: 10,
  plotCount: 163842,
  sharedUpgrades: { "node.broad_strokes": 1 },
  suitGear: { "gear.holster_rig": 1 },
  visitedOutposts: 1,
  beacons,
  players: [
    {
      playerId: PLAYER,
      displayName: "Cee",
      slot: 0,
      role: "holder",
      tenureLevel: 0,
      equippedCosmetics: [],
      connected: true,
      afk: false,
      hidden: false,
      toolsOwned: 1,
      equippedTool: 0,
      vehicleIds: [],
    },
  ],
  vehicles: [],
  robotCounts: { "robot.sandpiper": 1 },
  permissions: { tempCanBuild: false, tempCanSpendShared: false, tempCanDriveShared: false },
  fulfilled: false,
};

describe("ShiftState", () => {
  it("parses the plain view and the view with a tick", () => {
    const parsed = ShiftStateSchema.parse(state);
    expect(parsed.walletLumens).toBe(1234.5);
    expect(ShiftStateViewSchema.parse({ ...state, tick: 7 }).tick).toBe(7);
    expectTypeOf<ShiftStateView>().toExtend<ShiftState>();
    expectTypeOf<ShiftStateView["tick"]>().toEqualTypeOf<Tick>();
  });

  it("rejects wrong shapes", () => {
    expect(ShiftStateSchema.safeParse({ ...state, beacons: beacons.slice(1) }).success).toBe(false);
    expect(ShiftStateSchema.safeParse({ ...state, shiftType: "lobby" }).success).toBe(false);
    expect(ShiftStateSchema.safeParse({ ...state, simTickHz: 300 }).success).toBe(false);
    expect(ShiftStateSchema.safeParse({ ...state, sharedUpgrades: { "node.x": 300 } }).success).toBe(false);
    expect(ShiftStateSchema.safeParse({ ...state, contractId: "nope" }).success).toBe(false);
    expect(PermissionsSchema.safeParse({ tempCanBuild: true }).success).toBe(false);
  });

  it("has MVP subsets of shift types and roles", () => {
    expect(SHIFT_TYPES).toEqual(["solo", "private", "open"]);
    expect(MVP_SHIFT_TYPES).toEqual(["solo", "private"]);
    expect(CONTRACT_ROLES).toEqual(["holder", "supervisor", "staff", "temp"]);
    expect(MVP_CONTRACT_ROLES).toEqual(["holder", "staff"]);
  });
});

describe("components", () => {
  it("keeps the u5 / u6 / u4 enums inside their wire widths", () => {
    expect(MOVE_STATES.length).toBeLessThanOrEqual(32);
    expect(AVATAR_ACTION_STATES.length).toBe(41);
    expect(AVATAR_ACTION_STATES.length).toBeLessThanOrEqual(64);
    expect(AVATAR_ACTION_STATES[0]).toBe("none");
    expect(AVATAR_ACTION_STATES[7]).toBe("lane_lock");
    expect(AVATAR_ACTION_STATES[33]).toBe("emote_1");
    expect(AVATAR_ACTION_STATES[40]).toBe("emote_8");
    expect(ROBOT_UI_STATES).toHaveLength(9);
    expect(ROBOT_UI_STATES.length).toBeLessThanOrEqual(16);
    expect(ENTITY_KINDS).toHaveLength(8);
    expect(VEHICLE_GEARS).toHaveLength(4);
    expect(CARGO_KINDS).toEqual(["puck", "stack"]);
    expect(Object.values(AVATAR_FLAG_BIT)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("has typed avatar and tool shapes", () => {
    expectTypeOf<AvatarComponent["moveState"]>().toEqualTypeOf<(typeof MOVE_STATES)[number]>();
    expectTypeOf<ToolComponent["toolCode"]>().toEqualTypeOf<number>();
  });
});

describe("RoomSim", () => {
  it("builds RoomSimEvent from SimEventMap", () => {
    expect(MAX_PLAYERS_PER_ROOM).toBe(6);
    expectTypeOf<RoomSimEvent["name"]>().toEqualTypeOf<keyof SimEventMap>();
    const sold: RoomSimEvent = {
      name: "cargo.sold",
      payload: {
        tick: 5,
        actorSlot: 0,
        source: "assay_counter",
        grams: 1000,
        lm: 12,
        walletLm: 12,
        cargoKind: "dust",
      } as never,
    };
    expect(sold.name).toBe("cargo.sold");
    expect(SIM_EVENT_NAMES).toContain(sold.name);
  });

  it("exposes step, applyInput, applyIntent, addActor, removeActor, snapshot and onEvent", () => {
    expectTypeOf<RoomSim["step"]>().parameters.toEqualTypeOf<[dt: number]>();
    expectTypeOf<RoomSim["applyInput"]>().parameters.toEqualTypeOf<
      [actor: number, input: import("./input").SimInputCommand]
    >();
    expectTypeOf<RoomSim["snapshot"]>().returns.toExtend<{ tick: number; shift: ShiftState }>();
    expectTypeOf<RoomSim["onEvent"]>().returns.toEqualTypeOf<() => void>();
    expectTypeOf<RoomSim["tick"]>().toEqualTypeOf<Tick>();
  });
});
