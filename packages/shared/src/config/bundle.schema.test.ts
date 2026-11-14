import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { MAX_PLAYERS_PER_ROOM } from "../sim";
import { GAME_DATA_TABLES, type GameDataTable, prefixedId, uniqueIdArray } from "./common.schema";
import { GAME_DATA_TABLE_SCHEMAS, type GameDataBundle, GameDataBundleSchema } from "./bundle.schema";
import { BASELINE_FEATURE_IDS } from "./features.schema";
import type { EconomyTable } from "./economy.schema";
import { FIELD_GATE_PIECE_ID, type LogisticsTable } from "./logistics.schema";
import type { MovementTable } from "./movement.schema";
import type { PacingTargetDef } from "./pacing-targets.schema";
import {
  DUST_CELL_NODE_ID_PREFIX,
  type NodeLevelPrereq,
  type NodePrereq,
  PROMOTION_NODE_LEVEL_COUNTS,
} from "./promotions-board.schema";
import { NEST_PIECE_ID, ROBOT_STATE_IDS, ROOST_PIECE_ID, type RobotsTable } from "./robots.schema";
import { CHARGE_FINISH_STAMP_PARAM, CHARGE_TRAIT_ID } from "./traits.schema";
import type { FlatbedDef, VehiclesTable } from "./vehicles.schema";
import type { ToolsTable } from "./tools.schema";
import { type SunPath, SunPathSchema, type WorldTable, WORLD_SUN_PATH_DEFAULT, WorldSchema } from "./world.schema";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A small, internally consistent bundle of every baseline table (numbers are illustrative, not tuning). */
function validBundle(): GameDataBundle {
  const level = (costLm: number, stat: string, value: number) => ({
    costLm,
    effects: [{ stat, op: "mul" as const, value }],
  });
  return {
    world: {
      schemaVersion: 1,
      moonRadiusM: 1_737_400,
      gridFrequency: 128,
      plotCount: 163_842,
      gravityMps2: 1.62,
      dayLengthS: 3600,
      daylightFrac: 0.5,
      contractStartSunPhase: 0,
      sunPath: { maxElevationDeg: 40, minElevationDeg: -20 },
      terrainClasses: [
        { id: "terrain.highland", plotShareFrac: 0.83, dustLevel: 2 },
        { id: "terrain.mare", plotShareFrac: 0.16, dustLevel: 1 },
        { id: "terrain.crater_floor", plotShareFrac: 0.01, dustLevel: 4 },
      ],
      dustKgPerM2PerLevel: 0.1,
      openedThresholdFrac: 0.01,
      polishedThresholdFrac: 0.001,
      steepSlopeDeg: 25,
      steepSweepMult: 0.6,
      outpostMix: {
        radiusM: 600,
        shares: [
          { terrainId: "terrain.highland", frac: 0.9 },
          { terrainId: "terrain.mare", frac: 0.08 },
          { terrainId: "terrain.crater_floor", frac: 0.02 },
        ],
      },
      compoundRings: 1,
      landingApron: { plotsPerOutpost: 6, coverageFrac: 1, dustLevel: 1.24 },
    },
    economy: {
      schemaVersion: 1,
      materials: [
        { id: "material.dust", lmPerKg: 5 },
        { id: "material.glass_beads", lmPerKg: 15 },
      ],
      stampBaseLm: 50,
      relayFeeLm: 25,
      recallFeeLm: 100,
      repeatRequisitionFrac: 0.5,
      repeatRequisitionMinTier: 4,
      standardIssueMaxTier: 3,
      startWalletLm: 0,
      settle: { payFrac: 0.25 },
      refundRule: "paidPrice",
      tricks: [
        { id: "trick.hang_time", lm: 10 },
        { id: "trick.moonshot", lm: 25 },
      ],
      trickCapPerDriverLm: 500,
      trickCapPerShiftLm: 2000,
      trickCapWindowS: 3600,
      trickDriverOnly: true,
      trickComboMult: 1.5,
    },
    movement: {
      schemaVersion: 1,
      walkMps: 2.2,
      lopeMps: 3.5,
      sweepWalkMps: 1.2,
      jumpApexM: 1.5,
      hopBurstMps: 4,
      hopRechargeS: 3,
      nightPenaltyFrac: 0.3,
      lampPenaltyReliefFrac: 0.5,
      carryUnits: 1,
    },
    tools: {
      schemaVersion: 1,
      tools: [
        {
          id: "tool.desk_duster",
          tier: 1,
          priceLm: 0,
          widthM: 0.2,
          depthLevels: 1,
          reachM: 1,
          strokeS: 0.5,
          cellBaseKg: 2,
          traitId: "trait.detailing",
        },
        {
          id: "tool.crescent_squeegee",
          tier: 2,
          priceLm: 150,
          widthM: 0.4,
          depthLevels: 2,
          reachM: 1.2,
          strokeS: 0.6,
          cellBaseKg: 8,
          traitId: "trait.flick",
        },
        {
          id: "tool.assembly_gun",
          tier: 0,
          priceLm: 300,
          widthM: 0,
          depthLevels: 0,
          reachM: 0,
          strokeS: 0,
          cellBaseKg: 0,
          traitId: null,
        },
      ],
    },
    traits: {
      schemaVersion: 1,
      traits: [
        { id: "trait.detailing", params: { radiusM: 0.5 } },
        { id: "trait.flick", params: { airborneSweep: true } },
        { id: "trait.charge", params: { finishStampMult: 1.5 } },
      ],
    },
    "dust-cells": {
      schemaVersion: 1,
      levelMult: [1, 1.75, 2.5],
      costsLm: { "tool.desk_duster": [50, 150, 400], "tool.crescent_squeegee": [100, 300, 800] },
      puckKg: 1,
      stackMaxKg: 20,
      loosePuckCap: { perPlayer: 20, perContract: 200, despawnS: 600, despawnValueFrac: 0.5 },
    },
    "promotions-board": {
      schemaVersion: 1,
      hubId: "node.employee_badge",
      departments: [
        {
          id: "department.storage",
          nodeIds: [
            "node.dust_cell_crescent_squeegee",
            "node.dust_cell_desk_duster",
            "node.densifier",
            "node.overflow_former",
          ],
        },
      ],
      nodes: [
        {
          id: "node.dust_cell_crescent_squeegee",
          departmentId: "department.storage",
          kind: "root",
          levels: [
            level(100, "cellCapacityKg", 1.2),
            level(300, "cellCapacityKg", 1.4),
            level(800, "cellCapacityKg", 1.6),
          ],
          prereqs: [{ nodeId: "node.employee_badge", level: 1 }],
        },
        {
          id: "node.densifier",
          departmentId: "department.storage",
          kind: "secondary",
          levels: [level(500, "cellCapacityKg", 1.1), level(900, "cellCapacityKg", 1.2)],
          prereqs: [{ nodeId: "node.dust_cell_crescent_squeegee", level: 1 }],
        },
        {
          id: "node.overflow_former",
          departmentId: "department.storage",
          kind: "capstone",
          levels: [{ costLm: 5000, effects: [{ op: "flag", featureId: "overflow_former" }] }],
          prereqs: [
            { nodeId: "node.densifier", level: 2 },
            {
              anyOf: [
                { nodeId: "node.dust_cell_crescent_squeegee", level: 3 },
                { nodeId: "node.dust_cell_desk_duster", level: 3 },
              ],
            },
          ],
        },
        {
          id: "node.dust_cell_desk_duster",
          departmentId: "department.storage",
          kind: "root",
          levels: [
            level(50, "cellCapacityKg", 1.2),
            level(150, "cellCapacityKg", 1.4),
            level(400, "cellCapacityKg", 1.6),
          ],
          prereqs: [{ nodeId: "node.employee_badge", level: 1 }],
        },
      ],
    },
    "suit-gear": {
      schemaVersion: 1,
      lines: [
        { id: "gear.hop_pack", levels: [level(400, "hopBursts", 2), level(800, "hopBursts", 3)] },
        { id: "gear.ballast_soles", levels: [{ costLm: 250, effects: [] }] },
      ],
    },
    vehicles: {
      schemaVersion: 1,
      vehicles: [
        {
          id: "vehicle.trundle",
          tier: 1,
          priceLm: 1800,
          seats: 0,
          widthM: 1.6,
          cruiseMps: 3,
          boostMult: 1.3,
          depthLevels: 7,
          payloadKg: 200,
          puckSlots: 1,
          upgradeLineIds: ["vehicle_upgrade.gear_ratio"],
        },
        {
          id: "vehicle.carryall",
          tier: 3,
          priceLm: 12_000,
          seats: 8,
          widthM: 0,
          cruiseMps: 8,
          boostMult: 1.2,
          depthLevels: 0,
          payloadKg: 0,
          puckSlots: 8,
          upgradeLineIds: [],
          flatbed: { pucks: 40, stacks: 8, bales: 2 },
        },
      ],
      motorPoolParts: [
        { id: "piece.motor_pool", priceLm: 1000 },
        { id: "piece.dump_plate", priceLm: 200 },
        { id: "piece.dust_vault", priceLm: 1500, params: { storeKg: 20_000 } },
      ],
      vehiclesOutPerMotorPool: 1,
    },
    "vehicle-upgrades": {
      schemaVersion: 1,
      lines: [
        {
          id: "vehicle_upgrade.gear_ratio",
          levels: [{ costMultOfVehiclePrice: 0.25, effects: [{ stat: "cruiseMps", op: "mul", value: 1.1 }] }],
        },
      ],
    },
    robots: {
      schemaVersion: 1,
      roost: { basePriceLm: 5000, priceGrowthMult: 1.15, railAllowanceLm: 200, resiteDowntimeS: 30, resiteMaxM: 500 },
      units: [
        { id: "robot.sandpiper", rateM2ps: 0.5, binKg: 5, storeKg: 200, rings: 2, uptimeManualFrac: 0.85 },
        {
          id: "robot.plover",
          rateM2ps: 1,
          binKg: 10,
          storeKg: 400,
          rings: 3,
          uptimeManualFrac: 0.85,
          upgradePriceLm: 10_000,
        },
      ],
      albatross: {
        basePriceLm: 40_000,
        priceGrowthMult: 1.2,
        baleKg: 20,
        uptimeFrac: 0.9,
        nestPerUnits: 6,
        rateM2ps: 11,
      },
      nest: { priceLm: 30_000, capacityBales: 10, groupRadiusM: 50, fullFrac: 0.9 },
      states: [...ROBOT_STATE_IDS],
    },
    caps: {
      schemaVersion: 1,
      caps: { roost: 24, albatross: 24, machines: 14 },
      hardCaps: { robots: 48, machines: 14 },
      mvpRoostCap: 3,
    },
    logistics: {
      schemaVersion: 1,
      rail: { speedMps: 2, spacingM: 0.5, unitsPerS: 4 },
      puckKg: 1,
      stackMaxKg: 20,
      stackReleaseS: 2,
      baleKg: 20,
      pieces: [
        { id: "piece.puck_former", priceLm: 400 },
        { id: "piece.glide_rail", priceLm: 5, params: { perMetre: true } },
      ],
      gate: { railInputs: 3, baleChuteFaces: 1 },
      fieldGate: { priceLm: 60_000, railInputs: 2, railshotKg: 500, baleChuteFaces: 1 },
      assayCounter: { pourSlots: 4, pourS: 6 },
      railshotEveryKg: 1000,
      baleAcceptors: ["piece.field_gate", "piece.bead_kiln"],
    },
    production: {
      schemaVersion: 1,
      machines: [
        {
          id: "piece.bead_kiln",
          priceLm: 20_000,
          recipe: {
            in: [{ materialId: "material.dust", kg: 3 }],
            out: [{ materialId: "material.glass_beads", kg: 1 }],
          },
          grades: [{ throughputKgph: 300, upgradeCostLm: 0, powerKw: 10 }],
        },
      ],
      minPowerFrac: 0.25,
    },
    power: {
      schemaVersion: 1,
      pieces: [
        { id: "piece.sun_sprig", priceLm: 500, peakKw: 2, radiusM: 10, storageKwh: 0, tracksSun: false },
        { id: "piece.night_cell", priceLm: 2000, peakKw: 0, radiusM: 10, storageKwh: 20, tracksSun: false },
      ],
      fixedPanelModel: "sinElevation",
      trackerFullAtElevationDeg: 20,
      batteryRoundTripFrac: 0.9,
    },
    "build-pieces": {
      schemaVersion: 1,
      pieces: [
        ["piece.deck_plate", "foundations", 10],
        ["piece.motor_pool", "services", 1000],
        ["piece.dump_plate", "services", 200],
        ["piece.dust_vault", "services", 1500],
        ["piece.puck_former", "logistics", 400],
        ["piece.glide_rail", "logistics", 5],
        ["piece.field_gate", "logistics", 60_000],
        ["piece.roost", "robots", 5000],
        ["piece.nest", "robots", 30_000],
        ["piece.bead_kiln", "production", 20_000],
        ["piece.sun_sprig", "power", 500],
        ["piece.night_cell", "power", 2000],
      ].map(([id, tab, priceLm]) => ({
        id: id as string,
        tab: tab as string,
        priceLm: priceLm as number,
        footprint: { widthM: 2, depthM: 2 },
        snap: "grid",
        finishes: ["finish.brushed", "finish.chrome"],
      })),
      finishes: [{ id: "finish.brushed" }, { id: "finish.chrome" }],
      noBuildRadiusM: 15,
      tempBuildTabs: ["foundations"],
    },
    "plot-bonus": {
      schemaVersion: 1,
      stampBaseLm: 50,
      stampPremiumMult: [1.25, 1.5],
      chargeFinishMult: 1.5,
      creditRule: "lastSweeper",
      shineMilestonesFrac: [0.01, 0.05, 0.1],
    },
    collectibles: {
      schemaVersion: 1,
      strayCargo: [
        { size: "near_parcel", count: 32, lm: 25 },
        { size: "parcel", count: 58, lm: 50 },
        { size: "crate", count: 45, lm: 150 },
        { size: "pallet", count: 15, lm: 500 },
      ],
      surveyPoints: [{ id: "survey.tycho_peak", featureName: "Tycho central peak", lm: 1000 }],
    },
    onboarding: {
      schemaVersion: 1,
      induction: [{ id: "onboarding.first_sweep", trigger: "firstStroke", rewardLm: 0 }],
      probation: [{ id: "onboarding.buy_squeegee", trigger: "toolBought", suggestsId: "tool.crescent_squeegee" }],
    },
    achievements: {
      schemaVersion: 1,
      achievements: [
        {
          id: "achievement.first_stamp",
          displayName: "First Stamp",
          stat: "plotsStamped",
          threshold: 1,
          hidden: false,
        },
      ],
    },
    moderation: {
      schemaVersion: 1,
      onBreakAfterS: 600,
      tempRemoveOnBreakS: 1800,
      idleCloseS: 1800,
      openShiftAdmitRequiresLeadOnlineS: 600,
      tempVoteKick: { minVotes: 3 },
      cleanupOrder: { cooldownS: 60 },
      serviceCall: { durationS: 60, maxPerDay: 3 },
      loanerKit: { maxVehiclesOut: 4 },
    },
    features: {
      schemaVersion: 1,
      features: BASELINE_FEATURE_IDS.map((id) => ({ id, description: `Rule ${id}.` })),
    },
    "pacing-targets": {
      schemaVersion: 1,
      targets: [
        {
          id: "pacing.trundle_solo",
          milestone: "first_vehicle",
          players: 1,
          attendanceFrac: 1,
          policy: "reference",
          metric: "time",
          min: 1.2,
          max: 1.8,
          unit: "h",
          toleranceFrac: 0.1,
        },
      ],
    },
  };
}

/** Paths of the issues a parse reports, joined with dots. */
function issuePaths(result: { success: boolean; error?: z.ZodError }): string[] {
  return result.error?.issues.map((issue) => issue.path.join(".")) ?? [];
}

/** Applies `mutate` to a fresh copy of one table and returns the issue paths of its schema. */
function tableIssues<K extends GameDataTable>(table: K, mutate: (t: GameDataBundle[K]) => void): string[] {
  const data = validBundle()[table];
  mutate(data);
  const result = GAME_DATA_TABLE_SCHEMAS[table].safeParse(clone(data));
  expect(result.success, `${table} should be rejected`).toBe(false);
  return issuePaths(result);
}

/** Applies `mutate` to a fresh valid bundle and returns the bundle issue paths. */
function bundleIssues(mutate: (b: GameDataBundle) => void): string[] {
  const data = validBundle();
  mutate(data);
  const result = GameDataBundleSchema.safeParse(clone(data));
  expect(result.success, "bundle should be rejected").toBe(false);
  return issuePaths(result);
}

describe("config table schemas v1: coverage", () => {
  it("has exactly one schema per baseline table and no optional section 24 tables", () => {
    expect(Object.keys(GAME_DATA_TABLE_SCHEMAS)).toEqual([...GAME_DATA_TABLES]);
  });

  it.each(GAME_DATA_TABLES)("%s: valid fixture parses and JSON round-trips", (table) => {
    const json = clone(validBundle()[table]);
    const parsed = GAME_DATA_TABLE_SCHEMAS[table].parse(json);
    expect(clone(parsed)).toEqual(json);
  });

  it.each(GAME_DATA_TABLES)("%s: rejects a missing or wrong schemaVersion and unknown keys", (table) => {
    expect(tableIssues(table, (t) => Object.assign(t, { schemaVersion: 2 }))).toContain("schemaVersion");
    expect(tableIssues(table, (t) => Object.assign(t, { extraField: 1 }))).toContain("");
  });

  it("parses the whole valid bundle", () => {
    const parsed = GameDataBundleSchema.parse(clone(validBundle()));
    expect(clone(parsed)).toEqual(clone(validBundle()));
  });

  it("infers useful types", () => {
    expectTypeOf<ToolsTable["tools"][number]["traitId"]>().toEqualTypeOf<string | null>();
    expectTypeOf<WorldTable["schemaVersion"]>().toEqualTypeOf<1>();
    expectTypeOf<keyof GameDataBundle>().toEqualTypeOf<GameDataTable>();
    expectTypeOf<GameDataBundle["dust-cells"]["levelMult"]>().toEqualTypeOf<[number, number, number]>();
  });
});

describe("config table schemas v1: reference mode has no redesign gates", () => {
  const optional: [GameDataTable, string, (t: never) => void][] = [
    ["economy", "bulkRateFrac", (t: GameDataBundle["economy"]) => Object.assign(t, { bulkRateFrac: 0.25 })],
    [
      "robots",
      "uptimeAutoFrac",
      (t: GameDataBundle["robots"]) => Object.assign(t.units[0] ?? {}, { uptimeAutoFrac: 1 }),
    ],
    ["robots", "workFront", (t: GameDataBundle["robots"]) => Object.assign(t, { workFront: {} })],
    ["caps", "byReview", (t: GameDataBundle["caps"]) => Object.assign(t, { byReview: [] })],
    [
      "moderation",
      "roomCloseNoEffortS",
      (t: GameDataBundle["moderation"]) => Object.assign(t, { roomCloseNoEffortS: 1 }),
    ],
    ["moderation", "minTenure", (t: GameDataBundle["moderation"]) => Object.assign(t.tempVoteKick, { minTenure: 5 })],
    ["vehicle-upgrades", "refit", (t: GameDataBundle["vehicle-upgrades"]) => Object.assign(t, { refit: {} })],
    ["plot-bonus", "closingBonusMult", (t: GameDataBundle["plot-bonus"]) => Object.assign(t, { closingBonusMult: 2 })],
    ["collectibles", "coreSamples", (t: GameDataBundle["collectibles"]) => Object.assign(t, { coreSamples: {} })],
    ["onboarding", "tenureXp", (t: GameDataBundle["onboarding"]) => Object.assign(t, { tenureXp: 10 })],
    [
      "promotions-board",
      "gateReviewId",
      (t: GameDataBundle["promotions-board"]) =>
        Object.assign(t.nodes[0]?.levels[0] ?? {}, { gateReviewId: "review.one" }),
    ],
    [
      "promotions-board",
      "shineFrac prereq",
      (t: GameDataBundle["promotions-board"]) => Object.assign(t.nodes[0]?.prereqs[0] ?? {}, { shineFrac: 0.01 }),
    ],
  ];

  it.each(optional)("%s rejects %s", (table, _field, mutate) => {
    expect(tableIssues(table, mutate as (t: GameDataBundle[typeof table]) => void).length).toBeGreaterThan(0);
  });
});

describe("config table schemas v1: field and intra-table checks", () => {
  it("id helpers enforce namespace and uniqueness", () => {
    expect(prefixedId("tool").safeParse("tool.lane_broom").success).toBe(true);
    expect(prefixedId("tool").safeParse("vehicle.lane_broom").success).toBe(false);
    expect(prefixedId("tool").safeParse("toolbox.lane_broom").success).toBe(false);
    const list = uniqueIdArray(z.strictObject({ id: prefixedId("tool") }));
    expect(list.safeParse([{ id: "tool.a" }, { id: "tool.b" }]).success).toBe(true);
    expect(issuePaths(list.safeParse([{ id: "tool.a" }, { id: "tool.a" }]))).toEqual(["1.id"]);
    expect(tableIssues("tools", (t) => t.tools.push(clone(t.tools[0]!)))).toContain("tools.3.id");
    expect(tableIssues("tools", (t) => Object.assign(t.tools[0]!, { id: "vehicle.desk_duster" }))).toContain(
      "tools.0.id",
    );
  });

  it("number fields reject negatives, fractions over 1 and non-integer prices", () => {
    expect(tableIssues("tools", (t) => Object.assign(t.tools[1]!, { priceLm: -1 }))).toContain("tools.1.priceLm");
    expect(tableIssues("tools", (t) => Object.assign(t.tools[1]!, { priceLm: 1.5 }))).toContain("tools.1.priceLm");
    expect(tableIssues("movement", (t) => Object.assign(t, { nightPenaltyFrac: 1.2 }))).toContain("nightPenaltyFrac");
    expect(tableIssues("movement", (t) => Object.assign(t, { walkMps: 0 }))).toContain("walkMps");
  });

  it("world: derived plot count, terrain shares and outpost mix", () => {
    expect(tableIssues("world", (t) => Object.assign(t, { plotCount: 163_841 }))).toContain("plotCount");
    expect(tableIssues("world", (t) => Object.assign(t.terrainClasses[0]!, { plotShareFrac: 0.5 }))).toContain(
      "terrainClasses",
    );
    expect(tableIssues("world", (t) => Object.assign(t.outpostMix.shares[0]!, { terrainId: "terrain.ice" }))).toContain(
      "outpostMix.shares.0.terrainId",
    );
    expect(tableIssues("world", (t) => Object.assign(t.outpostMix.shares[0]!, { frac: 0.5 }))).toContain(
      "outpostMix.shares",
    );
  });

  it("world: sunPath defaults to the D1 arc (40 / -20) and rejects impossible arcs (v1.1)", () => {
    const withoutPath = clone(validBundle().world) as Record<string, unknown>;
    delete withoutPath.sunPath;
    const parsed = WorldSchema.parse(withoutPath);
    expect(parsed.sunPath).toEqual({ maxElevationDeg: 40, minElevationDeg: -20 });
    expect(parsed.sunPath).toEqual(WORLD_SUN_PATH_DEFAULT);
    // The default is a fresh object per parse, so a consumer cannot corrupt the next one.
    expect(parsed.sunPath).not.toBe(WorldSchema.parse(withoutPath).sunPath);
    expect(SunPathSchema.parse({ maxElevationDeg: 60, minElevationDeg: -5 })).toEqual({
      maxElevationDeg: 60,
      minElevationDeg: -5,
    });
    expect(SunPathSchema.safeParse({ maxElevationDeg: 40, minElevationDeg: 5 }).success).toBe(false);
    expect(SunPathSchema.safeParse({ maxElevationDeg: 0, minElevationDeg: -20 }).success).toBe(false);
    expect(SunPathSchema.safeParse({ maxElevationDeg: 91, minElevationDeg: -20 }).success).toBe(false);
    expect(SunPathSchema.safeParse({ maxElevationDeg: 40, minElevationDeg: -20, extra: 1 }).success).toBe(false);
    expect(tableIssues("world", (t) => Object.assign(t, { sunPath: { maxElevationDeg: 40 } }))).toContain(
      "sunPath.minElevationDeg",
    );
    expectTypeOf<WorldTable["sunPath"]>().toEqualTypeOf<SunPath>();
  });

  it("economy: tier order, trick caps, refund rule", () => {
    expect(tableIssues("economy", (t) => Object.assign(t, { standardIssueMaxTier: 4 }))).toContain(
      "standardIssueMaxTier",
    );
    expect(tableIssues("economy", (t) => Object.assign(t, { trickCapPerDriverLm: 5000 }))).toContain(
      "trickCapPerDriverLm",
    );
    expect(tableIssues("economy", (t) => Object.assign(t, { refundRule: "half" }))).toContain("refundRule");
  });

  it("tools: unique tiers, cleaning tools need a trait, the build tool has none", () => {
    expect(tableIssues("tools", (t) => Object.assign(t.tools[1]!, { tier: 1 }))).toContain("tools.1.tier");
    expect(tableIssues("tools", (t) => Object.assign(t.tools[0]!, { traitId: null }))).toContain("tools.0.tier");
    expect(tableIssues("tools", (t) => Object.assign(t.tools[2]!, { traitId: "trait.flick" }))).toContain(
      "tools.2.traitId",
    );
  });

  it("dust-cells: three levels, stacks hold at least a puck, caps ordered", () => {
    expect(tableIssues("dust-cells", (t) => Object.assign(t, { levelMult: [1, 2] }))).toContain("levelMult");
    expect(tableIssues("dust-cells", (t) => Object.assign(t, { costsLm: { "vehicle.x": [1, 2, 3] } }))).toContain(
      "costsLm.vehicle.x",
    );
    expect(tableIssues("dust-cells", (t) => Object.assign(t, { stackMaxKg: 0.5 }))).toContain("stackMaxKg");
    expect(tableIssues("dust-cells", (t) => Object.assign(t.loosePuckCap, { perPlayer: 500 }))).toContain(
      "loosePuckCap.perPlayer",
    );
  });

  it("promotions-board: level counts per kind, departments, prereqs and cycles", () => {
    expect(PROMOTION_NODE_LEVEL_COUNTS).toEqual({ root: 3, secondary: 2, capstone: 1 });
    expect(tableIssues("promotions-board", (t) => t.nodes[0]!.levels.pop())).toContain("nodes.0.levels");
    expect(
      tableIssues("promotions-board", (t) => Object.assign(t.nodes[1]!, { departmentId: "department.accounts" })),
    ).toContain("nodes.1.departmentId");
    expect(tableIssues("promotions-board", (t) => t.departments[0]!.nodeIds.pop())).toContain("nodes.2.departmentId");
    expect(
      tableIssues("promotions-board", (t) => Object.assign(t.nodes[1]!.prereqs[0]!, { nodeId: "node.missing" })),
    ).toContain("nodes.1.prereqs.0");
    expect(tableIssues("promotions-board", (t) => Object.assign(t.nodes[2]!.prereqs[0]!, { level: 3 }))).toContain(
      "nodes.2.prereqs.0",
    );
    expect(
      tableIssues("promotions-board", (t) => t.nodes[0]!.prereqs.push({ nodeId: "node.overflow_former", level: 1 })),
    ).toContain("nodes");
    expect(tableIssues("promotions-board", (t) => Object.assign(t, { hubId: "node.densifier" }))).toContain("hubId");
  });

  it("vehicles: unique tiers and upgrade line ids", () => {
    expect(tableIssues("vehicles", (t) => Object.assign(t.vehicles[1]!, { tier: 1 }))).toContain("vehicles.1.tier");
    expect(tableIssues("vehicles", (t) => t.vehicles[0]!.upgradeLineIds.push("vehicle_upgrade.gear_ratio"))).toContain(
      "vehicles.0.upgradeLineIds.1",
    );
  });

  it("robots: all 9 states once", () => {
    expect(tableIssues("robots", (t) => t.states.pop())).toContain("states");
    expect(tableIssues("robots", (t) => t.states.push("resting"))).toContain("states");
  });

  it("caps: within perf hard caps", () => {
    expect(tableIssues("caps", (t) => Object.assign(t.hardCaps, { robots: 64 }))).toContain("hardCaps.robots");
    expect(tableIssues("caps", (t) => Object.assign(t.caps, { roost: 30 }))).toContain("caps");
    expect(tableIssues("caps", (t) => Object.assign(t, { mvpRoostCap: 25 }))).toContain("mvpRoostCap");
  });

  it("production and power: one baseline grade, known panel model", () => {
    expect(
      tableIssues("production", (t) =>
        t.machines[0]!.grades.push({ throughputKgph: 600, upgradeCostLm: 10_000, powerKw: 20 }),
      ),
    ).toContain("machines.0.grades");
    expect(tableIssues("power", (t) => Object.assign(t, { fixedPanelModel: "flat" }))).toContain("fixedPanelModel");
  });

  it("build-pieces: finishes and temporary tabs exist", () => {
    expect(tableIssues("build-pieces", (t) => t.pieces[0]!.finishes.push("finish.gold"))).toContain(
      "pieces.0.finishes.2",
    );
    expect(tableIssues("build-pieces", (t) => t.tempBuildTabs.push("decor"))).toContain("tempBuildTabs.1");
  });

  it("plot-bonus, collectibles, onboarding, pacing-targets", () => {
    expect(tableIssues("plot-bonus", (t) => Object.assign(t, { shineMilestonesFrac: [0.1, 0.05] }))).toContain(
      "shineMilestonesFrac.1",
    );
    expect(tableIssues("collectibles", (t) => t.strayCargo.push({ size: "crate", count: 1, lm: 1 }))).toContain(
      "strayCargo.4.size",
    );
    expect(
      tableIssues("onboarding", (t) => Object.assign(t.probation[0]!, { id: "onboarding.first_sweep" })),
    ).toContain("probation.0");
    expect(tableIssues("pacing-targets", (t) => Object.assign(t.targets[0]!, { min: 2 }))).toContain("targets.0.min");
    expect(
      tableIssues("pacing-targets", (t) => Object.assign(t.targets[0]!, { players: MAX_PLAYERS_PER_ROOM + 1 })),
    ).toContain("targets.0.players");
  });
});

describe("GameDataBundleSchema v1: cross-table references", () => {
  it("tools, traits and Dust Cells", () => {
    expect(bundleIssues((b) => b.traits.traits.splice(1, 1))).toContain("tools.tools.1.traitId");
    expect(bundleIssues((b) => delete b["dust-cells"].costsLm["tool.crescent_squeegee"])).toContain(
      "dust-cells.costsLm.tool.crescent_squeegee",
    );
    expect(bundleIssues((b) => (b["dust-cells"].costsLm["tool.assembly_gun"] = [1, 2, 3]))).toContain(
      "dust-cells.costsLm.tool.assembly_gun",
    );
  });

  it("vehicle lines, recipe materials and flag features", () => {
    expect(
      bundleIssues((b) => Object.assign(b["vehicle-upgrades"].lines[0]!, { id: "vehicle_upgrade.wide_mouth" })),
    ).toContain("vehicles.vehicles.0.upgradeLineIds.0");
    expect(bundleIssues((b) => b.economy.materials.pop())).toContain("production.machines.0.recipe.out.0.materialId");
    expect(bundleIssues((b) => (b.features.features = b.features.features.slice(1)))).toContain(
      "promotions-board.nodes.2.levels.0.effects.0.featureId",
    );
  });

  it("pieces exist in build-pieces at the same price", () => {
    expect(bundleIssues((b) => (b["build-pieces"].pieces = b["build-pieces"].pieces.slice(1, -1)))).toContain(
      "power.pieces.1.id",
    );
    expect(bundleIssues((b) => Object.assign(b.production.machines[0]!, { priceLm: 1 }))).toContain(
      "production.machines.0.priceLm",
    );
    expect(bundleIssues((b) => b.logistics.baleAcceptors.push("piece.receiving_gate"))).toContain(
      "logistics.baleAcceptors.2",
    );
  });

  it("probation suggestions and repeated constants", () => {
    expect(bundleIssues((b) => Object.assign(b.onboarding.probation[0]!, { suggestsId: "tool.lane_broom" }))).toContain(
      "onboarding.probation.0.suggestsId",
    );
    expect(bundleIssues((b) => Object.assign(b["plot-bonus"], { stampBaseLm: 60 }))).toContain(
      "plot-bonus.stampBaseLm",
    );
    expect(bundleIssues((b) => Object.assign(b.logistics, { puckKg: 2 }))).toContain("dust-cells.puckKg");
    expect(bundleIssues((b) => Object.assign(b.logistics, { stackMaxKg: 25 }))).toContain("dust-cells.stackMaxKg");
    expect(bundleIssues((b) => Object.assign(b.logistics, { baleKg: 25 }))).toContain("robots.albatross.baleKg");
  });

  it("rejects a bundle with a missing or extra table", () => {
    const missing: Partial<GameDataBundle> = validBundle();
    delete missing.caps;
    expect(GameDataBundleSchema.safeParse(missing).success).toBe(false);
    expect(GameDataBundleSchema.safeParse({ ...validBundle(), "on-shift-bonus": { schemaVersion: 1 } }).success).toBe(
      false,
    );
  });
});

/** Removes the fields that stay optional (`units[].upgradePriceLm`, `flatbed`). */
function stripOptionals(b: GameDataBundle): GameDataBundle {
  for (const unit of b.robots.units) delete unit.upgradePriceLm;
  for (const vehicle of b.vehicles.vehicles) delete vehicle.flatbed;
  return b;
}

/** Issue paths when `remove` deletes a field from a plain-JSON copy of the valid bundle. */
function missingIssues(remove: (b: Record<string, Record<string, unknown>>) => void): string[] {
  const raw = clone(validBundle()) as unknown as Record<string, Record<string, unknown>>;
  remove(raw);
  const result = GameDataBundleSchema.safeParse(raw);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("config contract v1.1/v1.2: added fields", () => {
  it("tables without the still-optional fields parse", () => {
    const bare = stripOptionals(validBundle());
    expect(GameDataBundleSchema.safeParse(clone(bare)).success).toBe(true);
  });

  it("v1.2: v1.1 fields made required are rejected when missing", () => {
    type Obj = Record<string, unknown>;
    const at = (o: unknown, ...keys: (string | number)[]): Obj =>
      keys.reduce<Obj>((acc, key) => acc[key] as Obj, o as Obj);
    expect(missingIssues((b) => delete at(b, "robots", "albatross").rateM2ps)).toContain("robots.albatross.rateM2ps");
    expect(missingIssues((b) => delete at(b, "economy").trickComboMult)).toContain("economy.trickComboMult");
    expect(missingIssues((b) => delete at(b, "movement").carryUnits)).toContain("movement.carryUnits");
    expect(missingIssues((b) => delete at(b, "logistics", "assayCounter").pourS)).toContain(
      "logistics.assayCounter.pourS",
    );
    expect(missingIssues((b) => delete at(b, "logistics", "fieldGate").baleChuteFaces)).toContain(
      "logistics.fieldGate.baleChuteFaces",
    );
    expect(missingIssues((b) => delete at(b, "pacing-targets", "targets", 0).milestone)).toContain(
      "pacing-targets.targets.0.milestone",
    );
  });

  it("new fields round-trip; required and optional typing", () => {
    const parsed = GameDataBundleSchema.parse(clone(validBundle()));
    expect(parsed.robots.units[1]?.upgradePriceLm).toBe(10_000);
    expect(parsed.robots.albatross.rateM2ps).toBe(11);
    expect(parsed.economy.trickComboMult).toBe(1.5);
    expect(parsed.movement.carryUnits).toBe(1);
    expect(parsed.vehicles.vehicles[1]?.flatbed).toEqual({ pucks: 40, stacks: 8, bales: 2 });
    expect(parsed.logistics.fieldGate.baleChuteFaces).toBe(1);
    expect(parsed.logistics.assayCounter.pourS).toBe(6);
    expect(parsed["pacing-targets"].targets[0]?.milestone).toBe("first_vehicle");
    expectTypeOf<RobotsTable["units"][number]["upgradePriceLm"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<RobotsTable["albatross"]["rateM2ps"]>().toEqualTypeOf<number>();
    expectTypeOf<EconomyTable["trickComboMult"]>().toEqualTypeOf<number>();
    expectTypeOf<MovementTable["carryUnits"]>().toEqualTypeOf<number>();
    expectTypeOf<VehiclesTable["vehicles"][number]["flatbed"]>().toEqualTypeOf<FlatbedDef | undefined>();
    expectTypeOf<LogisticsTable["fieldGate"]["baleChuteFaces"]>().toEqualTypeOf<number>();
    expectTypeOf<LogisticsTable["assayCounter"]["pourS"]>().toEqualTypeOf<number>();
    expectTypeOf<PacingTargetDef["milestone"]>().toEqualTypeOf<string>();
  });

  it("new fields reject bad values", () => {
    expect(tableIssues("robots", (t) => Object.assign(t.units[1]!, { upgradePriceLm: 1.5 }))).toContain(
      "units.1.upgradePriceLm",
    );
    expect(tableIssues("robots", (t) => Object.assign(t.albatross, { rateM2ps: 0 }))).toContain("albatross.rateM2ps");
    expect(tableIssues("economy", (t) => Object.assign(t, { trickComboMult: 0 }))).toContain("trickComboMult");
    expect(tableIssues("movement", (t) => Object.assign(t, { carryUnits: 0 }))).toContain("carryUnits");
    expect(
      tableIssues("vehicles", (t) => Object.assign(t.vehicles[1]!, { flatbed: { pucks: 40, stacks: 8 } })),
    ).toContain("vehicles.1.flatbed.bales");
    expect(tableIssues("logistics", (t) => Object.assign(t.assayCounter, { pourS: 0 }))).toContain(
      "assayCounter.pourS",
    );
    expect(
      tableIssues("pacing-targets", (t) => Object.assign(t.targets[0]!, { milestone: "First Vehicle" })),
    ).toContain("targets.0.milestone");
  });

  it("logistics: the Field Gate is a Bale acceptor exactly when it has Bale Chute faces", () => {
    expect(FIELD_GATE_PIECE_ID).toBe("piece.field_gate");
    expect(tableIssues("logistics", (t) => Object.assign(t.fieldGate, { baleChuteFaces: 0 }))).toContain(
      "fieldGate.baleChuteFaces",
    );
    expect(tableIssues("logistics", (t) => (t.baleAcceptors = ["piece.bead_kiln"]))).toContain(
      "fieldGate.baleChuteFaces",
    );
    const noFaces = validBundle().logistics;
    noFaces.fieldGate.baleChuteFaces = 0;
    noFaces.baleAcceptors = ["piece.bead_kiln"];
    expect(GAME_DATA_TABLE_SCHEMAS.logistics.safeParse(clone(noFaces)).success).toBe(true);
  });
});

describe("config contract v1.1: anyOf node prerequisites", () => {
  const anyOf = (t: GameDataBundle["promotions-board"]): NodeLevelPrereq[] => {
    const prereq = t.nodes[2]!.prereqs[1]!;
    if (!("anyOf" in prereq)) throw new Error("fixture lost its anyOf prereq");
    return prereq.anyOf;
  };

  it("types a prereq as a node level or a choice of node levels", () => {
    expectTypeOf<NodePrereq>().toEqualTypeOf<NodeLevelPrereq | { anyOf: NodeLevelPrereq[] }>();
    const parsed = GAME_DATA_TABLE_SCHEMAS["promotions-board"].parse(clone(validBundle()["promotions-board"]));
    expect(parsed.nodes[2]?.prereqs[1]).toEqual({
      anyOf: [
        { nodeId: "node.dust_cell_crescent_squeegee", level: 3 },
        { nodeId: "node.dust_cell_desk_duster", level: 3 },
      ],
    });
  });

  it("rejects fewer than 2 alternatives, mixed shapes, unknown or too-high alternatives", () => {
    expect(tableIssues("promotions-board", (t) => anyOf(t).pop())).toContain("nodes.2.prereqs.1.anyOf");
    expect(
      tableIssues("promotions-board", (t) => Object.assign(t.nodes[2]!.prereqs[1]!, { nodeId: "node.densifier" })),
    ).toContain("nodes.2.prereqs.1");
    expect(tableIssues("promotions-board", (t) => Object.assign(anyOf(t)[0]!, { nodeId: "node.missing" }))).toContain(
      "nodes.2.prereqs.1.anyOf.0",
    );
    expect(tableIssues("promotions-board", (t) => Object.assign(anyOf(t)[1]!, { level: 4 }))).toContain(
      "nodes.2.prereqs.1.anyOf.1",
    );
    expect(
      tableIssues("promotions-board", (t) => Object.assign(anyOf(t)[1]!, { nodeId: "node.overflow_former" })),
    ).toContain("nodes.2.prereqs.1.anyOf.1");
  });

  it("treats every alternative as a dependency edge for cycle detection", () => {
    expect(
      tableIssues("promotions-board", (t) =>
        t.nodes[3]!.prereqs.push({
          anyOf: [
            { nodeId: "node.employee_badge", level: 1 },
            { nodeId: "node.overflow_former", level: 1 },
          ],
        }),
      ),
    ).toContain("nodes");
  });
});

describe("GameDataBundleSchema v1.1: duplicated constants agree", () => {
  it("each cleaning tool has a Dust Cell node with the dust-cells costs, and only tools do", () => {
    expect(DUST_CELL_NODE_ID_PREFIX).toBe("node.dust_cell_");
    expect(bundleIssues((b) => Object.assign(b["promotions-board"].nodes[0]!.levels[1]!, { costLm: 301 }))).toContain(
      "promotions-board.nodes.0.levels.1.costLm",
    );
    expect(
      bundleIssues((b) => {
        const board = b["promotions-board"];
        board.nodes[3]!.id = "node.desk_duster_cell";
        board.departments[0]!.nodeIds[1] = "node.desk_duster_cell";
        board.nodes[2]!.prereqs[1] = { nodeId: "node.dust_cell_crescent_squeegee", level: 3 };
      }),
    ).toContain("promotions-board.nodes");
    expect(
      bundleIssues((b) => {
        const board = b["promotions-board"];
        board.nodes[3]!.id = "node.dust_cell_lane_broom";
        board.departments[0]!.nodeIds[1] = "node.dust_cell_lane_broom";
        board.nodes[2]!.prereqs[1] = { nodeId: "node.dust_cell_crescent_squeegee", level: 3 };
      }),
    ).toContain("promotions-board.nodes.3.id");
  });

  it("Roost, Nest and Field Gate prices equal their build pieces", () => {
    expect([ROOST_PIECE_ID, NEST_PIECE_ID]).toEqual(["piece.roost", "piece.nest"]);
    expect(bundleIssues((b) => Object.assign(b.robots.roost, { basePriceLm: 5001 }))).toContain(
      "robots.roost.basePriceLm",
    );
    expect(
      bundleIssues((b) => (b["build-pieces"].pieces = b["build-pieces"].pieces.filter((p) => p.id !== "piece.nest"))),
    ).toContain("robots.nest.priceLm");
    expect(bundleIssues((b) => Object.assign(b.logistics.fieldGate, { priceLm: 1 }))).toContain(
      "logistics.fieldGate.priceLm",
    );
  });

  it("Charge finishStampMult equals plot-bonus.chargeFinishMult", () => {
    expect([CHARGE_TRAIT_ID, CHARGE_FINISH_STAMP_PARAM]).toEqual(["trait.charge", "finishStampMult"]);
    expect(bundleIssues((b) => Object.assign(b["plot-bonus"], { chargeFinishMult: 2 }))).toContain(
      "traits.traits.2.params.finishStampMult",
    );
    expect(bundleIssues((b) => b.traits.traits.pop())).toContain("traits.traits");
  });
});
