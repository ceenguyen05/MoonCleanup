import { describe, expect, it } from "vitest";
import { loadGameData, parseVehicleFeel, VEHICLE_FEEL } from "./index";

describe("vehicle-feel table", () => {
  it("defines every MVP vehicle that vehicles.json defines", () => {
    for (const v of loadGameData().vehicles.vehicles) {
      if (v.id === "vehicle.trundle") expect(VEHICLE_FEEL[v.id]).toBeDefined();
    }
    expect(Object.keys(VEHICLE_FEEL)).toContain("vehicle.trundle");
  });

  it("keeps the Trundle numbers of the former sim table (golden)", () => {
    const t = VEHICLE_FEEL["vehicle.trundle"]!;
    expect(t.probeForwardM).toEqual([0.55, -0.35, -0.35]);
    expect(t.probeRightM).toEqual([0, -0.55, 0.55]);
    expect([t.restLengthM, t.travelM, t.wheelRadiusM]).toEqual([0.18, 0.05, 0.2]);
    expect([t.springHz, t.springZeta, t.accelS, t.brakeMps2, t.coastMps2, t.reverseMps]).toEqual([
      3, 0.5, 1, 6, 2, 1.5,
    ]);
    expect([t.turnDegPerS, t.turnInPlaceDegPerS, t.inPlaceSpeedMps]).toEqual([120, 90, 0.2]);
    expect([t.gripPerS, t.handbrakeGripMult, t.steerRatePerS, t.groundSnapM]).toEqual([20, 0.35, 8, 0.4]);
    expect([t.boostMeterS, t.boostRegenDelayS, t.boostRegenPerS]).toEqual([4, 1, 0.5]);
    expect([t.tractionFadeStartDeg, t.slideStartDeg, t.slideFriction]).toEqual([20, 25, 0.2]);
    expect([t.drumForwardM, t.handleBackM, t.enterReachM]).toEqual([0.55, 0.9, 2.5]);
    expect(t.tipS).toBe(2);
  });

  it("Fast Tip reduces unload time without a vehicle trip-time effect at either level", () => {
    const line = loadGameData()["vehicle-upgrades"].lines.find((l) => l.id === "vehicle_upgrade.fast_tip")!;
    const unload = line.levels.map((lv) => lv.effects.find((e) => "stat" in e && e.stat === "vehicleUnloadTimeMult"));
    expect(unload.map((e) => (e && "value" in e ? e.value : null))).toEqual([0.6, 0.3]);
    for (const level of line.levels) {
      expect(level.effects.some((e) => "stat" in e && e.stat === "vehicleTripTimeMult")).toBe(false);
    }
  });

  it("is deeply frozen and rejects a malformed table", () => {
    expect(Object.isFrozen(VEHICLE_FEEL)).toBe(true);
    expect(Object.isFrozen(VEHICLE_FEEL["vehicle.trundle"])).toBe(true);
    expect(Object.isFrozen(VEHICLE_FEEL["vehicle.trundle"]!.probeForwardM)).toBe(true);
    expect(() => parseVehicleFeel({ schemaVersion: 1, vehicles: { "vehicle.trundle": { accelS: 0 } } })).toThrow(
      /vehicle-feel failed validation/,
    );
  });

  it("rejects equal front-drum and wheel probe offsets (would divide by zero in the sim)", () => {
    const base = VEHICLE_FEEL["vehicle.trundle"]!;
    const bad = { ...base, probeForwardM: [0.1, 0.1, 0.1] };
    expect(() => parseVehicleFeel({ schemaVersion: 1, vehicles: { "vehicle.trundle": bad } })).toThrow(
      /vehicle-feel failed validation/,
    );
    expect(() => parseVehicleFeel({ schemaVersion: 1, vehicles: { "vehicle.trundle": { ...base } } })).not.toThrow();
  });
});
