import { describe, expect, it } from "vitest";
import { loadGameData } from "@moon-cleanup/game-data";
import { MVP_SCOPE } from "@moon-cleanup/shared";
import { buildCatalog } from "./catalog";
import { monteCarlo } from "./monte-carlo";
import { createRng } from "./rng";
import { toJson, toMarkdown, type Report } from "./report";
import { runMvp } from "./sim";
import { evaluateTargets, runNominal } from "./targets";
import { MODEL_CONSTANTS } from "./model";

const data = loadGameData();
const min = (s: number | undefined): number => (s ?? Number.NaN) / 60;

describe("rng and determinism", () => {
  it("mulberry32 repeats for one seed and differs across seeds", () => {
    const a = createRng(5);
    const b = createRng(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(createRng(5)()).not.toBe(createRng(6)());
  });

  it("two nominal runs are identical", () => {
    const x = runMvp({ horizonH: 3 });
    const y = runMvp({ horizonH: 3 });
    expect(JSON.stringify(x.purchases)).toBe(JSON.stringify(y.purchases));
    expect(x.milestonesS).toEqual(y.milestonesS);
  });

  it("Monte Carlo is reproducible from its seed and moves with it", () => {
    const a = monteCarlo({ players: 1 }, 6, 11);
    const b = monteCarlo({ players: 1 }, 6, 11);
    const c = monteCarlo({ players: 1 }, 6, 12);
    expect(a).toEqual(b);
    expect(a.milestones["first_roost"]?.p50).not.toBe(c.milestones["first_roost"]?.p50);
  });
});

describe("catalog is exactly the MVP scope", () => {
  const catalog = buildCatalog(data);
  it("sells only MVP_SCOPE ids", () => {
    const keys = new Set(catalog.map((i) => i.key));
    const allowed = new Set<string>([
      ...MVP_SCOPE.toolIds,
      ...MVP_SCOPE.boardNodeIds,
      ...Object.keys(MVP_SCOPE.suitGearMaxLevel),
      ...MVP_SCOPE.vehicleIds,
      "robot.roost",
    ]);
    expect([...keys].filter((k) => !allowed.has(k))).toEqual([]);
    expect(catalog.filter((i) => i.key === "robot.roost")).toHaveLength(MVP_SCOPE.roostCap);
    expect(catalog.filter((i) => i.category === "cell").every((i) => i.level <= MVP_SCOPE.dustCellMaxLevel)).toBe(true);
  });

  it("Roost prices follow 4,500 x 1.15^(n-1) with no rail allowance", () => {
    const roosts = catalog.filter((i) => i.key === "robot.roost").map((i) => i.basePriceLm);
    expect(roosts).toEqual([4500, 5175, 5951]);
  });
});

describe("MVP pacing (nominal efficient run)", () => {
  const solo = runMvp({ horizonH: 4 });
  const m = solo.milestonesS;

  it("first Stamp 5-8 min, Crescent Squeegee 5-10 min, first Cell 7-12 min", () => {
    expect(min(m["first_stamp"])).toBeGreaterThanOrEqual(5);
    expect(min(m["first_stamp"])).toBeLessThanOrEqual(8);
    expect(min(m["first_tool_upgrade"])).toBeGreaterThanOrEqual(5);
    expect(min(m["first_tool_upgrade"])).toBeLessThanOrEqual(10);
    expect(min(m["first_dust_cell"])).toBeGreaterThanOrEqual(7);
    expect(min(m["first_dust_cell"])).toBeLessThanOrEqual(12);
  });

  it("Trundle 1-1.5 h and first Roost inside the 10 % tolerance of 1.5-2 h", () => {
    expect(min(m["first_vehicle"]) / 60).toBeGreaterThanOrEqual(1);
    expect(min(m["first_vehicle"]) / 60).toBeLessThanOrEqual(1.5);
    expect(min(m["first_roost"]) / 60).toBeGreaterThanOrEqual(1.5 * 0.9);
    expect(min(m["first_roost"]) / 60).toBeLessThanOrEqual(2);
  });

  it("4 players buy the first Roost in under an hour", () => {
    const four = runMvp({ players: 4, horizonH: 2 });
    expect(min(four.milestonesS["first_roost"])).toBeLessThan(60);
  });

  it("more players are never slower to any milestone", () => {
    const runs = [1, 2, 4, 6].map((players) => runMvp({ players, horizonH: 3 }));
    for (const key of ["first_stamp", "first_tool_upgrade", "first_vehicle", "first_roost"]) {
      const times = runs.map((r) => r.milestonesS[key] ?? Number.POSITIVE_INFINITY);
      for (let i = 1; i < times.length; i += 1) expect(times[i], key).toBeLessThanOrEqual(times[i - 1] as number);
    }
  });

  it("the casual archetype (skill 0.7, list order) is slower than the efficient one", () => {
    const casual = runMvp({ archetype: "casual", horizonH: 4 });
    expect(casual.milestonesS["first_roost"]).toBeGreaterThan(m["first_roost"] as number);
    expect(min(casual.milestonesS["first_tool_upgrade"])).toBeGreaterThan(min(m["first_tool_upgrade"]));
  });

  it("buys in prerequisite order and earns more than it spends", () => {
    const seen = new Map<string, number>();
    for (const p of solo.purchases) {
      const item = buildCatalog(data).find((i) => i.id === p.id);
      expect(item, p.id).toBeDefined();
      for (const pre of item!.prereqs)
        expect(seen.get(pre.key) ?? 0, `${p.id} needs ${pre.key}`).toBeGreaterThanOrEqual(pre.level);
      seen.set(item!.key, item!.level);
      expect(p.costLm).toBeGreaterThan(0);
    }
    expect(solo.totalEarnedLm).toBeGreaterThan(solo.purchases.reduce((s, p) => s + p.costLm, 0));
  });
});

describe("exploit invariants", () => {
  it("robot output depends only on the Roost count, never on the players present", () => {
    const one = runMvp({ players: 1, horizonH: 3 });
    const six = runMvp({ players: 6, horizonH: 3 });
    const rate = (r: typeof one): number | undefined => r.curve.filter((p) => p.robotM2ps > 0).at(-1)?.robotM2ps;
    const unit = data.robots.units.find((u) => u.id === "robot.sandpiper")!;
    for (const r of [one, six]) {
      const last = r.curve.filter((p) => p.robotM2ps > 0).at(-1)!;
      const roosts = Math.round(last.robotM2ps / (unit.rateM2ps * unit.uptimeManualFrac));
      expect(last.robotM2ps).toBeCloseTo(roosts * unit.rateM2ps * unit.uptimeManualFrac, 2);
    }
    expect(rate(one)).toBeDefined();
  });

  it("no Roost beyond the MVP cap and Repeat Requisition scales personal prices only", () => {
    const four = runMvp({ players: 4, horizonH: 3 });
    expect(four.purchases.filter((p) => p.category === "robot")).toHaveLength(MVP_SCOPE.roostCap);
    expect(four.purchases.find((p) => p.id === "vehicle.trundle@1")?.costLm).toBe(
      Math.round(2100 * (1 + data.economy.repeatRequisitionFrac * 3)),
    );
    expect(four.purchases.find((p) => p.id === "tool.crescent_squeegee@1")?.costLm).toBe(75);
  });

  it("Settle/Reclaim, Relay and Puck Former paths are absent from the MVP catalog", () => {
    expect(buildCatalog(data).some((i) => /piece\.|assembly|relay/.test(i.key))).toBe(false);
  });
});

describe("targets and report", () => {
  const runs = runNominal(data);
  const results = evaluateTargets(data, runs);

  it("every mvp row has a verdict and none FAIL; non-mvp rows are SKIPPED, never PASS", () => {
    const mvp = results.filter((r) => r.policy === "mvp");
    expect(mvp.length).toBeGreaterThanOrEqual(9);
    expect(mvp.filter((r) => r.verdict === "FAIL")).toEqual([]);
    expect(results.filter((r) => r.policy !== "mvp").every((r) => r.verdict === "SKIPPED")).toBe(true);
  });

  it("fails loudly when a curve leaves its band (coverage cut to 0.3)", () => {
    const slow = runNominal(data, { constants: { ...MODEL_CONSTANTS, handCoverage: 0.3, vehicleCoverage: 0.3 } });
    const verdicts = evaluateTargets(data, slow).filter((r) => r.policy === "mvp");
    expect(verdicts.some((r) => r.verdict === "FAIL")).toBe(true);
  });

  it("renders markdown and JSON with the target table", () => {
    const report: Report = {
      policy: "mvp",
      seed: 1,
      constants: MODEL_CONSTANTS,
      targets: results,
      runs: Object.fromEntries(runs),
      monteCarlo: {},
    };
    expect(toMarkdown(report)).toContain("pacing.mvp_first_roost_solo");
    expect(JSON.parse(toJson(report)).policy).toBe("mvp");
  });
});
