import { describe, expect, test } from "vitest";
import { loadGameData, type GameData } from "@moon-cleanup/game-data";
import { createSimConfig } from "../../src/index";
import { runGoldenReplay } from "../golden/replay";

// The sim reads every feel value from the game-data tables (config v1.3). Each case edits one table value in a clone
// of the bundle and expects the replay hash to move; the unedited clone must reproduce the baseline exactly.
const TICKS = 1500;

function edited(edit: (d: { -readonly [K in keyof GameData]: GameData[K] }) => void): GameData {
  const d = JSON.parse(JSON.stringify(loadGameData())) as { -readonly [K in keyof GameData]: GameData[K] };
  edit(d);
  return d as GameData;
}

describe("sim reads feel from game-data", () => {
  const baseline = runGoldenReplay(TICKS);

  test("an unedited clone reproduces the baseline", () => {
    expect(
      runGoldenReplay(
        TICKS,
        edited(() => undefined),
      ),
    ).toEqual(baseline);
  });

  test("SimConfig mirrors the tables", () => {
    const cfg = createSimConfig(loadGameData());
    const d = loadGameData();
    expect(cfg.feel.accelWalkMps2).toBe(d.movement.groundAccelMps2);
    expect(cfg.feel.landFaceplantMps).toBe(d.movement.faceplantMps);
    expect(cfg.toolFeel.headLiftMps).toBe(d["tool-feel"].headSpeedLiftMps);
    expect(cfg.cargo.pickupRadiusM).toBe(d["tool-feel"].pickupRadiusM);
    expect(cfg.cargo.formHoldTicks).toBe(Math.round(d["tool-feel"].formPuckHoldS * cfg.tickHz));
    expect(cfg.cargo.throwMaxMps).toBe(d["tool-feel"].throwMaxMps);
    expect(cfg.cargo.mergeRadiusM).toBe(d["tool-feel"].puckMergeRadiusM);
    expect(cfg.detailingWidthCm).toBe(50);
    expect(cfg.detailingDiameterMm).toBe(500);
  });

  test("puck feel keys in tool-feel.json drive SimConfig.cargo", () => {
    const cfg = createSimConfig(
      edited((d) => {
        Object.assign(d["tool-feel"], { throwMaxMps: 10, puckSkidDecelMps2: 5, throwPitchDeg: 45 });
      }),
    );
    expect(cfg.cargo.throwMaxMps).toBe(10);
    expect(cfg.cargo.skidDecelMps2).toBe(5);
    expect(cfg.cargo.throwSin).toBeCloseTo(Math.SQRT1_2, 6);
  });

  test("changing a movement.json value changes the replay", () => {
    const h = runGoldenReplay(
      TICKS,
      edited((d) => {
        (d.movement as { groundAccelMps2: number }).groundAccelMps2 = 12;
      }),
    );
    expect(h.stateHash).not.toBe(baseline.stateHash);
  });

  test("changing a tool-feel.json value changes the replay", () => {
    const h = runGoldenReplay(
      TICKS,
      edited((d) => {
        (d["tool-feel"] as { detailingMoveMult: number }).detailingMoveMult = 0.6;
      }),
    );
    expect(h.stateHash).not.toBe(baseline.stateHash);
  });

  test("the Detailing disc size comes from trait.detailing diameterM", () => {
    const d = edited((x) => {
      const t = x.traits.traits.find((tr) => tr.id === "trait.detailing")!;
      (t.params as Record<string, number>)["diameterM"] = 0.8;
    });
    const cfg = createSimConfig(d);
    expect(cfg.detailingWidthCm).toBe(80);
    expect(cfg.detailingDiameterMm).toBe(800);
    expect(runGoldenReplay(TICKS, d).stateHash).not.toBe(baseline.stateHash);
  });
});
