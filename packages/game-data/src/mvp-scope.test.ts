// Keeps the MVP slice honest (M1-W0-T03 asked for this check; M1-W2-T05 delivers it): every id in MVP_SCOPE must exist in
// the loaded bundle, the MVP content must be self-contained (prerequisites stay inside the slice), and the dust levels
// and Opened/Polished thresholds in world.json must match what the 4-bit coarse ledger can store and what
// `packages/shared` (world/dust.ts) divides by.
import { describe, expect, it } from "vitest";
import {
  LEDGER_MAX_DUST_LEVEL,
  LEDGER_TEXEL_AREA_MM2,
  LEDGER_UNITS_PER_LEVEL,
  LEDGER_UNIT_MAX,
  MVP_SCOPE,
  OPENED_THRESHOLD_DIVISOR,
  POLISHED_THRESHOLD_DIVISOR,
} from "@moon-cleanup/shared";
import { BOREAL_SUN_PATH, DISPLAY_NAMES, dayPhase, isDaylight, loadGameData, sunElevationDeg } from "./index";

const data = loadGameData();
const board = data["promotions-board"];
const node = (id: string) => board.nodes.find((n) => n.id === id);

describe("MVP_SCOPE ids exist in the tables", () => {
  it("tools: T1 to T4, contiguous tiers, all with a trait", () => {
    const tools = MVP_SCOPE.toolIds.map((id) => data.tools.tools.find((t) => t.id === id));
    expect(tools.every((t) => t !== undefined)).toBe(true);
    expect(tools.map((t) => t!.tier)).toEqual([1, 2, 3, 4]);
    expect(tools.every((t) => t!.traitId !== null)).toBe(true);
    expect(tools[0]!.priceLm).toBe(0);
  });

  it("board nodes: 10 present, every prerequisite is the hub or another MVP node", () => {
    expect(MVP_SCOPE.boardNodeIds).toHaveLength(10);
    const inScope = new Set<string>([board.hubId, ...MVP_SCOPE.boardNodeIds]);
    for (const id of MVP_SCOPE.boardNodeIds) {
      const n = node(id);
      expect(n, id).toBeDefined();
      for (const p of n!.prereqs) {
        if ("anyOf" in p)
          expect(
            p.anyOf.some((a) => inScope.has(a.nodeId)),
            `${id} anyOf`,
          ).toBe(true);
        else expect(inScope.has(p.nodeId), `${id} needs ${p.nodeId}`).toBe(true);
      }
    }
  });

  it("Dust Cells: MVP cap is within every offered Cell line and matches the Cell table", () => {
    const cellNodes = MVP_SCOPE.boardNodeIds.filter((id) => id.startsWith("node.dust_cell_"));
    expect(cellNodes).toHaveLength(MVP_SCOPE.toolIds.length);
    for (const id of cellNodes) expect(node(id)!.levels.length).toBeGreaterThanOrEqual(MVP_SCOPE.dustCellMaxLevel);
    expect(data["dust-cells"].levelMult.length).toBeGreaterThanOrEqual(MVP_SCOPE.dustCellMaxLevel);
    for (const toolId of MVP_SCOPE.toolIds) {
      const costs = data["dust-cells"].costsLm[toolId];
      expect(costs, toolId).toBeDefined();
      expect(costs!.length).toBeGreaterThanOrEqual(MVP_SCOPE.dustCellMaxLevel);
      // The board node and dust-cells.json must price the same Cell (single source is the table, two views of it).
      const n = node(`node.dust_cell_${toolId.replace("tool.", "")}`)!;
      expect(n.levels.map((l) => l.costLm)).toEqual([...costs!]);
    }
  });

  it("suit gear, vehicles, robots, achievements, roost cap", () => {
    for (const [lineId, maxLevel] of Object.entries(MVP_SCOPE.suitGearMaxLevel)) {
      const line = data["suit-gear"].lines.find((l) => l.id === lineId);
      expect(line, lineId).toBeDefined();
      expect(line!.levels.length).toBeGreaterThanOrEqual(maxLevel);
    }
    for (const id of MVP_SCOPE.vehicleIds)
      expect(
        data.vehicles.vehicles.some((v) => v.id === id),
        id,
      ).toBe(true);
    for (const id of MVP_SCOPE.robotIds)
      expect(
        data.robots.units.some((u) => u.id === id),
        id,
      ).toBe(true);
    for (const id of MVP_SCOPE.achievementIds) {
      expect(
        data.achievements.achievements.some((a) => a.id === id),
        id,
      ).toBe(true);
    }
    expect(MVP_SCOPE.roostCap).toBe(data.caps.mvpRoostCap);
    expect(MVP_SCOPE.roostCap).toBeLessThanOrEqual(data.caps.caps.roost);
  });

  it("every in-scope item has a display label", () => {
    const ids = [
      ...MVP_SCOPE.toolIds,
      ...MVP_SCOPE.boardNodeIds,
      ...Object.keys(MVP_SCOPE.suitGearMaxLevel),
      ...MVP_SCOPE.vehicleIds,
      ...MVP_SCOPE.robotIds,
    ];
    expect(ids.filter((id) => !DISPLAY_NAMES[id])).toEqual([]);
  });

  it("Near Parcels and Induction (8 steps, step 8 finds a Near Parcel)", () => {
    const near = data.collectibles.strayCargo.find((c) => c.size === "near_parcel");
    expect(near).toBeDefined();
    expect(MVP_SCOPE.nearParcelCount).toBeLessThanOrEqual(near!.count);
    expect(data.onboarding.induction).toHaveLength(8);
    expect(data.onboarding.induction[7]!.trigger).toBe("nearParcelFound");
    expect(data.onboarding.induction.every((s) => s.rewardLm === 0)).toBe(true);
  });

  it("MVP content has no Assembly Gun / Puck Former dependency in the Induction list", () => {
    const suggested = data.onboarding.induction.map((s) => s.id).join(",");
    expect(suggested).not.toMatch(/assembly_gun|puck_former|glide_rail/);
  });
});

describe("dust levels and ledger thresholds", () => {
  const w = data.world;

  it("every terrain and Apron dust level is a whole level inside the 4-bit ledger (<= 15)", () => {
    const levels = [...w.terrainClasses.map((t) => t.dustLevel), w.landingApron.dustLevel];
    for (const level of levels) {
      expect(Number.isInteger(level)).toBe(true);
      expect(level).toBeLessThanOrEqual(15);
      expect(level).toBeLessThanOrEqual(LEDGER_MAX_DUST_LEVEL);
      expect(level * LEDGER_UNITS_PER_LEVEL).toBeLessThanOrEqual(LEDGER_UNIT_MAX);
    }
  });

  it("Opened / Polished fractions are exactly the 1/1000 and 1/100 ledger divisors", () => {
    expect(1 / w.openedThresholdFrac).toBeCloseTo(OPENED_THRESHOLD_DIVISOR, 9);
    expect(1 / w.polishedThresholdFrac).toBeCloseTo(POLISHED_THRESHOLD_DIVISOR, 9);
    expect(w.openedThresholdFrac).toBeLessThan(w.polishedThresholdFrac);
  });

  it("integer thresholds are reachable for every plot class (Opened >= 1 unit, Polished leaves room)", () => {
    const plotM2 = (4 * Math.PI * w.moonRadiusM ** 2) / w.plotCount;
    const texelM2 = LEDGER_TEXEL_AREA_MM2 / 1e6;
    const classes = [
      ...w.terrainClasses.map((t) => ({ id: t.id, level: t.dustLevel, areaM2: plotM2 })),
      { id: "apron", level: w.landingApron.dustLevel, areaM2: plotM2 * w.landingApron.coverageFrac },
    ];
    for (const c of classes) {
      const initialUnits = Math.round((c.areaM2 / texelM2) * c.level * LEDGER_UNITS_PER_LEVEL);
      const opened = Math.ceil(initialUnits / OPENED_THRESHOLD_DIVISOR);
      const polishedRemaining = Math.floor(initialUnits / POLISHED_THRESHOLD_DIVISOR);
      expect(opened, c.id).toBeGreaterThanOrEqual(1);
      expect(polishedRemaining, c.id).toBeGreaterThanOrEqual(1);
      expect(opened, c.id).toBeLessThan(initialUnits - polishedRemaining);
    }
  });
});

describe("day / night (decision D1)", () => {
  it("is a 60-minute day, 30 minutes lit, and the contract starts at sunrise", () => {
    expect(data.world.dayLengthS).toBe(3600);
    expect(data.world.dayLengthS * data.world.daylightFrac).toBe(1800);
    expect(data.world.contractStartSunPhase).toBe(0);
  });
});

describe("Boreal gameplay sun path (D1)", () => {
  const cycle = data.world;
  it("rises at contract start, peaks at the lit midpoint, sets at 30 min, bottoms out at midnight", () => {
    expect(sunElevationDeg(cycle, 0)).toBeCloseTo(0, 9);
    expect(sunElevationDeg(cycle, 900)).toBeCloseTo(BOREAL_SUN_PATH.maxElevationDeg, 9);
    expect(sunElevationDeg(cycle, 1800)).toBeCloseTo(0, 9);
    expect(sunElevationDeg(cycle, 2700)).toBeCloseTo(BOREAL_SUN_PATH.minElevationDeg, 9);
    expect(sunElevationDeg(cycle, 3600)).toBeCloseTo(0, 9);
  });

  it("is above the horizon exactly while lit, and the dawn preset (4 deg) arrives in the first minute", () => {
    for (let t = 0; t < 7200; t += 30) {
      const el = sunElevationDeg(cycle, t + 1);
      expect(el > 0, `t=${t + 1}`).toBe(isDaylight(cycle, t + 1));
    }
    expect(sunElevationDeg(cycle, 58)).toBeGreaterThan(3.9);
    expect(sunElevationDeg(cycle, 55)).toBeLessThan(4);
    expect(dayPhase(cycle, 5400)).toBeCloseTo(0.5, 9);
  });

  it("peak stays inside the range the lighting presets are authored for", () => {
    expect(BOREAL_SUN_PATH.maxElevationDeg).toBeGreaterThanOrEqual(30);
    expect(BOREAL_SUN_PATH.maxElevationDeg).toBeLessThanOrEqual(60);
    expect(BOREAL_SUN_PATH.minElevationDeg).toBeLessThan(0);
  });
});
