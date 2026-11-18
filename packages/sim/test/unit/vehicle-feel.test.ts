// M1-W7 vehicle-feel swap: the sim's Trundle handling reads the data-driven game-data `VEHICLE_FEEL` table (shared
// config/vehicle-feel.schema v1), not sim-local numbers; a different validated table changes the motion; same table +
// same inputs stay bit-identical.
import { describe, expect, test } from "vitest";
import { loadGameData, parseVehicleFeel, VEHICLE_FEEL } from "@moon-cleanup/game-data";
import {
  createSimConfig,
  Fnv1a32,
  hashVehicle,
  resolveVehicleTuning,
  spawnVehicle,
  stepVehicle,
  vehicleHandlePoint,
  VEHICLE_HANDLING,
  VehicleIntent,
  VehicleState,
  vehicleKindOf,
  type VehicleTuning,
} from "../../src/index";
import { FLAT_GROUND } from "../support/world";

const data = loadGameData();
const cfg = createSimConfig(data);

function variantFeel(patch: Record<string, number>): ReturnType<typeof parseVehicleFeel> {
  const trundle = { ...VEHICLE_FEEL["vehicle.trundle"]!, ...patch };
  return parseVehicleFeel({ schemaVersion: 1, vehicles: { "vehicle.trundle": trundle } });
}

/** Drives a Trundle 60 ticks (throttle + a steer wave + a boost burst); returns the state hash and the vehicle. */
function drive(tuning: VehicleTuning): { hash: number; v: VehicleState } {
  const v = new VehicleState(tuning.lines.length);
  spawnVehicle(v, tuning, cfg, FLAT_GROUND, vehicleKindOf(tuning, "vehicle.trundle"), 0, 0, 0, 1, 1, 0, 0);
  v.driverSlot = 0;
  const intent = new VehicleIntent();
  for (let k = 0; k < 60; k++) {
    intent.throttle = 1;
    intent.steer = k < 20 ? 0 : k < 40 ? 1 : -0.5;
    intent.boost = k >= 30 && k < 45;
    stepVehicle(v, intent, tuning, cfg, FLAT_GROUND);
  }
  const h = new Fnv1a32();
  hashVehicle(v, h);
  return { hash: h.value, v };
}

describe("vehicle handling reads game-data VEHICLE_FEEL", () => {
  test("the sim table IS the game-data table and the resolved Trundle handling points at it", () => {
    expect(VEHICLE_HANDLING).toBe(VEHICLE_FEEL);
    const tuning = resolveVehicleTuning(data, cfg);
    const k = tuning.kinds[vehicleKindOf(tuning, "vehicle.trundle")]!;
    const def = VEHICLE_FEEL["vehicle.trundle"]!;
    expect(k.handling!.def).toBe(def);
    expect(k.handling!.accelMps2PerCruise).toBe(1 / def.accelS);
    expect(k.handling!.turnRadPerS).toBe((def.turnDegPerS * Math.PI) / 180);
    expect(k.handling!.boostMeterMs).toBe(Math.round(def.boostMeterS * 1000));
    expect(k.handling!.omega).toBe(2 * Math.PI * def.springHz);
  });

  test("vehicles without a feel row resolve to null handling (M2 kinds)", () => {
    const tuning = resolveVehicleTuning(data, cfg);
    for (const k of tuning.kinds) expect(k.handling === null).toBe(VEHICLE_FEEL[k.id] === undefined);
  });

  test("a different feel table changes the motion; the default equals passing VEHICLE_FEEL explicitly", () => {
    const base = drive(resolveVehicleTuning(data, cfg)).hash;
    expect(drive(resolveVehicleTuning(data, cfg, VEHICLE_FEEL)).hash).toBe(base);
    expect(drive(resolveVehicleTuning(data, cfg, variantFeel({ accelS: 2 }))).hash).not.toBe(base);
    expect(drive(resolveVehicleTuning(data, cfg, variantFeel({ turnDegPerS: 60 }))).hash).not.toBe(base);
    expect(drive(resolveVehicleTuning(data, cfg, variantFeel({ boostMeterS: 0.5 }))).hash).not.toBe(base);
  });

  test("handle point follows handleBackM from the table", () => {
    const out = new Float64Array(3);
    for (const back of [0.9, 1.4]) {
      const tuning = resolveVehicleTuning(data, cfg, variantFeel({ handleBackM: back }));
      const { v } = drive(tuning);
      vehicleHandlePoint(v, tuning, out);
      const d = Math.hypot(out[0]! - v.px, out[1]! - v.py, out[2]! - v.pz);
      expect(d).toBeCloseTo(back, 4); // heading is quantized, so |f| is 1 to ~1e-6
    }
  });

  test("same table + same inputs: bit-identical state across independent tunings", () => {
    const a = drive(resolveVehicleTuning(data, cfg)).hash;
    const b = drive(resolveVehicleTuning(data, createSimConfig(loadGameData()))).hash;
    expect(a).toBe(b);
  });
});
