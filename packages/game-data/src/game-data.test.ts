import { describe, expect, it } from "vitest";
import {
  GAME_DATA_TABLES,
  GAME_DATA_TABLE_SCHEMAS,
  MAX_PLAYERS_PER_ROOM,
  type GameDataTable,
} from "@moon-cleanup/shared";
import { DISPLAY_NAMES, LABEL_ONLY_IDS, loadGameData, parseGameData, RAW_GAME_DATA } from "./index";

const data = loadGameData();
const clone = (): Record<GameDataTable, unknown> =>
  JSON.parse(JSON.stringify(RAW_GAME_DATA)) as Record<GameDataTable, unknown>;

describe("table files", () => {
  it.each(GAME_DATA_TABLES.map((t) => [t]))("%s parses with its shared schema", (table) => {
    const result = GAME_DATA_TABLE_SCHEMAS[table].safeParse(RAW_GAME_DATA[table]);
    expect(result.success, result.success ? "" : JSON.stringify(result.error.issues, null, 1)).toBe(true);
  });

  it("ships exactly the baseline tables", () => {
    expect(Object.keys(RAW_GAME_DATA).sort()).toEqual([...GAME_DATA_TABLES].sort());
  });
});

describe("bundle", () => {
  it("passes GameDataBundleSchema cross-table checks and is deeply frozen", () => {
    expect(Object.isFrozen(data)).toBe(true);
    expect(Object.isFrozen(data.tools.tools[0])).toBe(true);
    expect(loadGameData()).toBe(data);
  });

  it("rejects a piece whose price differs from build-pieces", () => {
    const raw = clone();
    const logistics = raw.logistics as { pieces: { priceLm: number }[] };
    logistics.pieces[0]!.priceLm += 1;
    expect(() => parseGameData(raw)).toThrow(/priceLm differs from build-pieces/);
  });

  it("rejects an unknown trait reference", () => {
    const raw = clone();
    (raw.tools as { tools: { traitId: string | null }[] }).tools[0]!.traitId = "trait.nope";
    expect(() => parseGameData(raw)).toThrow(/unknown trait/);
  });

  it("rejects a Field Gate with Bale Chute faces that is not a Bale acceptor", () => {
    const raw = clone();
    const logistics = raw.logistics as { baleAcceptors: string[] };
    logistics.baleAcceptors = logistics.baleAcceptors.filter((id) => id !== "piece.field_gate");
    expect(() => parseGameData(raw)).toThrow(/baleChuteFaces/);
  });
});

describe("contract v1.1 fields (formerly pending-fields.ts)", () => {
  it("carries every doc value in its table", () => {
    expect(data.robots.units.find((u) => u.id === "robot.plover")?.upgradePriceLm).toBe(10_000);
    expect(data.robots.units.find((u) => u.id === "robot.sandpiper")?.upgradePriceLm).toBeUndefined();
    expect(data.robots.albatross.rateM2ps).toBe(11);
    expect(data.economy.trickComboMult).toBe(1.5);
    expect(data.vehicles.vehicles.find((v) => v.id === "vehicle.carryall")?.flatbed).toEqual({
      pucks: 40,
      stacks: 8,
      bales: 2,
    });
    expect(data.vehicles.vehicles.filter((v) => v.flatbed).map((v) => v.id)).toEqual(["vehicle.carryall"]);
    expect(data.logistics.assayCounter.pourS).toBe(6);
    expect(data.logistics.fieldGate.baleChuteFaces).toBe(1);
    expect(data.logistics.gate.baleChuteFaces).toBeGreaterThan(0);
    expect(data.logistics.baleAcceptors).not.toContain("piece.receiving_gate");
    expect(data.movement.carryUnits).toBe(1);
  });

  it("gates Overflow Former on Densifier II plus any Dust Cell line at III", () => {
    const node = data["promotions-board"].nodes.find((n) => n.id === "node.overflow_former")!;
    const anyOf = node.prereqs.flatMap((p) => ("anyOf" in p ? [p.anyOf] : []));
    expect(anyOf).toHaveLength(1);
    const cellNodes = data["promotions-board"].nodes.filter((n) => n.id.startsWith("node.dust_cell_"));
    expect(anyOf[0]!.map((a) => a.nodeId).sort()).toEqual(cellNodes.map((n) => n.id).sort());
    expect(anyOf[0]!.every((a) => a.level === 3)).toBe(true);
    expect(node.prereqs).toContainEqual({ nodeId: "node.densifier", level: 2 });
  });

  it("tags every pacing row with a milestone", () => {
    for (const row of data["pacing-targets"].targets) expect(row.milestone, row.id).toBeTruthy();
  });
});

// Contract v1.3: these are the values packages/sim held as MOVEMENT_FEEL / TOOL_FEEL (sim golden replay stateHash
// 4037918216 was produced with them). Changing one is a feel change that re-baselines the sim golden.
describe("contract v1.3 feel keys (game-feel section 10)", () => {
  it("movement carries the sim's validated feel defaults", () => {
    const m = data.movement;
    expect([m.groundAccelMps2, m.lopeAccelMps2, m.groundDecelMps2, m.groundReverseAccelMps2]).toEqual([18, 8, 16, 30]);
    expect([m.facingTurnDegPerS, m.analogMinSpeedFrac]).toEqual([720, 0.15]);
    expect([m.slopeSlowStartDeg, m.slopeWalkMaxDeg, m.slopeUphillMinMult, m.slopeSlideFrictionFrac]).toEqual([
      20, 42, 0.5, 0.4,
    ]);
    expect(m.slopeProbeM).toBe(0.25);
    expect([m.jumpCutVelocityMult, m.coyoteS, m.jumpBufferS, m.touchdownGravityMult]).toEqual([0.45, 0.15, 0.15, 2.5]);
    expect([m.airAccelMps2, m.airBrakeMps2]).toEqual([2.5, 4]);
    expect([m.groundSnapSweepM, m.groundSnapWalkM, m.groundSnapLopeM, m.groundSnapOffAfterJumpS]).toEqual([
      0.4, 0.3, 0.15, 0.2,
    ]);
    expect([m.landingSoftMps, m.landingHeavyMps, m.faceplantMps]).toEqual([3.2, 5, 8]);
    expect([
      m.landingMediumRecoveryS,
      m.landingHeavyRecoveryS,
      m.landingMediumAccelMult,
      m.landingHeavyAccelMult,
    ]).toEqual([0.1, 0.25, 0.5, 0.3]);
    expect([m.faceplantMoveLockS, m.faceplantJumpLockS]).toEqual([0.8, 0.5]);
    expect([m.hopBurstAngleDeg, m.hopMaxUpMps, m.hopMaxHorizontalMps, m.hopMinIntervalS]).toEqual([35, 4.5, 7, 0.25]);
    expect([m.capsuleRadiusM, m.capsuleHeightM]).toEqual([0.32, 1.8]);
    expect([m.substepMaxDispM, m.substepsMin, m.substepsMax, m.holsterSwapS]).toEqual([0.15, 2, 8, 0.35]);
    // The sim used cos/sin(35 deg) literals; Math.cos/sin of hopBurstAngleDeg reproduce them bit-for-bit in V8.
    const rad = (m.hopBurstAngleDeg * Math.PI) / 180;
    expect([Math.cos(rad), Math.sin(rad)]).toEqual([0.8191520442889918, 0.573576436351046]);
  });

  it("tool-feel carries the sim's validated feel defaults and reproduces the section 10.2 push lengths", () => {
    const t = data["tool-feel"];
    expect(t).toEqual({
      schemaVersion: 1,
      contactFrac: 0.7,
      strokeLengthStrideFrac: 0.3,
      strokeLengthPadM: 0.05,
      strokeLengthMaxSweepMps: 2.96,
      bootClearanceM: 0.45,
      headSpeedLiftMps: 5.5,
      headSpeedResumeMps: 5,
      sweepFacingTurnDegPerS: 540,
      detailingMoveMult: 0.3,
      flickMaxFeetHeightM: 1.2,
      cellNearFullFrac: 0.9,
      formPuckHoldS: 0.3,
      bandPerStackS: 0.15,
      throwMinMps: 4,
      throwMaxMps: 8,
      throwChargeS: 0.8,
      throwPitchDeg: 30,
      throwHeightM: 1.2,
      puckSkidDecelMps2: 3,
      pickupRadiusM: 1.5,
      puckMergeRadiusM: 0.3,
      puckDropForwardM: 0.5,
    });
    const laneMult = Number(data.traits.traits.find((r) => r.id === "trait.lane_lock")?.params["sweepSpeedMult"]);
    const pushCm = data.tools.tools
      .filter((tool) => tool.tier > 0)
      .map((tool) => {
        const vMax = t.strokeLengthMaxSweepMps * (tool.traitId === "trait.lane_lock" ? laneMult : 1);
        return Math.round((t.strokeLengthStrideFrac * vMax * tool.strokeS + t.strokeLengthPadM) * 100);
      });
    expect(pushCm).toEqual([45, 54, 67, 87, 85, 94]);
  });

  it("Detailing is a 0.5 m diameter disc (stroke widthCm 50)", () => {
    const detailing = data.traits.traits.find((r) => r.id === "trait.detailing")!;
    expect(detailing.params).toEqual({ diameterM: 0.5 });
  });
});

describe("section 21 structure", () => {
  it("has the locked counts", () => {
    expect(data.tools.tools).toHaveLength(7);
    expect(data["promotions-board"].nodes).toHaveLength(23);
    expect(data["suit-gear"].lines).toHaveLength(5);
    expect(data["suit-gear"].lines.reduce((n, l) => n + l.levels.length, 0)).toBe(14);
    expect(data.vehicles.vehicles).toHaveLength(5);
    expect(data["vehicle-upgrades"].lines).toHaveLength(7);
    expect(data["vehicle-upgrades"].lines.reduce((n, l) => n + l.levels.length, 0)).toBe(16);
    expect(data["build-pieces"].pieces).toHaveLength(98);
    expect(data["build-pieces"].finishes).toHaveLength(6);
    expect(data.collectibles.surveyPoints).toHaveLength(24);
    expect(data.collectibles.strayCargo.reduce((n, c) => n + c.count, 0)).toBe(150);
    expect(data.onboarding.induction).toHaveLength(8);
    expect(data.achievements.achievements).toHaveLength(33);
  });

  it("matches the section 12 tab counts", () => {
    const count = (tab: string): number => data["build-pieces"].pieces.filter((p) => p.tab === tab).length;
    expect([count("services"), count("logistics"), count("production"), count("power"), count("structures")]).toEqual([
      7, 10, 2, 4, 75,
    ]);
  });

  it("keeps pacing rows inside the 6-player room cap", () => {
    for (const row of data["pacing-targets"].targets) expect(row.players).toBeLessThanOrEqual(MAX_PLAYERS_PER_ROOM);
  });
});

// Dust Cell node costs, Charge multiplier and Roost/Nest/Field Gate prices are now bundle-schema rules (contract v1.1).
describe("doc totals", () => {
  it("Steep slows sweeping", () => {
    expect(data.world.steepSweepMult).toBeLessThan(1);
  });

  it("whole board, suit gear and vehicle multiples match the economy doc totals", () => {
    const board = data["promotions-board"].nodes.flatMap((n) => n.levels).reduce((s, l) => s + l.costLm, 0);
    const gear = data["suit-gear"].lines.flatMap((l) => l.levels).reduce((s, l) => s + l.costLm, 0);
    expect(board).toBe(583_860);
    expect(gear).toBe(121_150);
    const lines = new Map(data["vehicle-upgrades"].lines.map((l) => [l.id, l]));
    const maxMult = (vehicleId: string): number =>
      data.vehicles.vehicles
        .find((v) => v.id === vehicleId)!
        .upgradeLineIds.flatMap((id) => lines.get(id)!.levels)
        .reduce((s, l) => s + l.costMultOfVehiclePrice, 0);
    expect(maxMult("vehicle.behemoth")).toBeCloseTo(6.3, 9);
    expect(maxMult("vehicle.carryall")).toBeCloseTo(2.5, 9);
  });
});

describe("display-name catalog", () => {
  const ids = new Set<string>([
    ...data.world.terrainClasses.map((r) => r.id),
    ...data.economy.materials.map((r) => r.id),
    ...data.economy.tricks.map((r) => r.id),
    ...data.tools.tools.map((r) => r.id),
    ...data.traits.traits.map((r) => r.id),
    data["promotions-board"].hubId,
    ...data["promotions-board"].nodes.map((r) => r.id),
    ...data["promotions-board"].departments.map((r) => r.id),
    ...data["suit-gear"].lines.map((r) => r.id),
    ...data.vehicles.vehicles.map((r) => r.id),
    ...data["vehicle-upgrades"].lines.map((r) => r.id),
    ...data.robots.units.map((r) => r.id),
    ...data["build-pieces"].pieces.map((r) => r.id),
    ...data["build-pieces"].finishes.map((r) => r.id),
    ...data.collectibles.surveyPoints.map((r) => r.id),
    ...data.onboarding.induction.map((r) => r.id),
    ...data.onboarding.probation.map((r) => r.id),
    ...LABEL_ONLY_IDS,
  ]);

  it("labels every player-facing id exactly once, with no orphans", () => {
    expect([...ids].filter((id) => !DISPLAY_NAMES[id])).toEqual([]);
    expect(Object.keys(DISPLAY_NAMES).filter((id) => !ids.has(id))).toEqual([]);
  });

  it("has no duplicate labels among purchasable items", () => {
    const seen = new Map<string, string>();
    for (const [id, label] of Object.entries(DISPLAY_NAMES)) {
      if (id.startsWith("onboarding.") || id.startsWith("survey.")) continue;
      expect(seen.get(label), `${id} duplicates ${seen.get(label) ?? ""}`).toBeUndefined();
      seen.set(label, id);
    }
  });
});

// Hand check of the reference-style opening (economy §18.2 / Appendix B) read from the tables, so a table edit that
// breaks "tiny brush -> short trip -> first sale -> first purchase" fails here before the balance-sim exists.
// Model constants are balance-sim inputs (§22.2), not tables: 0.75 hand coverage, 30 m Apron trip, 60 s of prompts.
// Pour time comes from the table (`assayCounter.pourS`).
describe("first minutes (reference loop)", () => {
  const HAND_COVERAGE = 0.75;
  const APRON_TRIP_M = 30;
  const PROMPTS_S = 60;
  const POUR_S = data.logistics.assayCounter.pourS ?? 6;
  const w = data.world;
  const tool = (id: string) => data.tools.tools.find((t) => t.id === id)!;
  const dust = data.economy.materials.find((m) => m.id === "material.regolith_dust")!.lmPerKg;
  const plotM2 = (4 * Math.PI * w.moonRadiusM ** 2) / w.plotCount;
  const apronM2 = plotM2 * w.landingApron.coverageFrac;
  const apronKg = apronM2 * w.landingApron.dustLevel * w.dustKgPerM2PerLevel;
  const tripS = (2 * APRON_TRIP_M) / data.movement.walkMps + POUR_S;

  it("starts with a free, tiny brush and a small Cell", () => {
    const duster = tool("tool.desk_duster");
    expect(duster.priceLm).toBe(0);
    expect(duster.widthM).toBeLessThanOrEqual(0.2);
    expect(duster.cellBaseKg).toBeLessThan(apronKg);
    expect(data.economy.startWalletLm).toBe(0);
  });

  it("first Inspector's Stamp lands in 5-8 min and pays for the first tool", () => {
    const duster = tool("tool.desk_duster");
    const rate = duster.widthM * data.movement.sweepWalkMps * HAND_COVERAGE;
    const trips = Math.ceil(apronKg / duster.cellBaseKg);
    const minutes = (apronM2 / rate + trips * tripS + PROMPTS_S) / 60;
    expect(minutes).toBeGreaterThanOrEqual(5);
    expect(minutes).toBeLessThanOrEqual(8);
    const firstPlotLm = data.economy.stampBaseLm + apronKg * dust;
    expect(firstPlotLm).toBeGreaterThanOrEqual(tool("tool.crescent_squeegee").priceLm);
  });

  it("hand tools grow steadily in width, Cell size and price", () => {
    const hand = data.tools.tools.filter((t) => t.tier > 0).sort((a, b) => a.tier - b.tier);
    for (let i = 1; i < hand.length; i += 1) {
      const [prev, cur] = [hand[i - 1]!, hand[i]!];
      expect(cur.widthM / prev.widthM).toBeGreaterThan(1.25);
      expect(cur.widthM / prev.widthM).toBeLessThan(2);
      expect(cur.cellBaseKg).toBeGreaterThan(prev.cellBaseKg);
      expect(cur.priceLm).toBeGreaterThan(prev.priceLm);
    }
  });
});
