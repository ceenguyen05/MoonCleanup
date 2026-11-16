import { describe, expect, expectTypeOf, it } from "vitest";
import { VehicleFeelDefSchema, VehicleFeelTableSchema, type VehicleFeelDef } from "./vehicle-feel.schema";

const TRUNDLE: VehicleFeelDef = {
  probeForwardM: [0.55, -0.35, -0.35],
  probeRightM: [0, -0.55, 0.55],
  restLengthM: 0.18,
  travelM: 0.05,
  wheelRadiusM: 0.2,
  springHz: 3,
  springZeta: 0.5,
  accelS: 1,
  brakeMps2: 6,
  coastMps2: 2,
  reverseMps: 1.5,
  turnDegPerS: 120,
  turnInPlaceDegPerS: 90,
  inPlaceSpeedMps: 0.2,
  gripPerS: 20,
  handbrakeGripMult: 0.35,
  steerRatePerS: 8,
  groundSnapM: 0.4,
  boostMeterS: 4,
  boostRegenDelayS: 1,
  boostRegenPerS: 0.5,
  tractionFadeStartDeg: 20,
  slideStartDeg: 25,
  slideFriction: 0.2,
  drumForwardM: 0.55,
  handleBackM: 0.9,
  enterReachM: 2.5,
};
const table = (v: unknown = TRUNDLE) => ({ schemaVersion: 1, vehicles: { "vehicle.trundle": v } });

describe("config/vehicle-feel.schema", () => {
  it("round-trips the Trundle table", () => {
    const parsed = VehicleFeelTableSchema.parse(JSON.parse(JSON.stringify(table())));
    expect(parsed.vehicles["vehicle.trundle"]).toEqual(TRUNDLE);
    expectTypeOf(parsed.vehicles["vehicle.trundle"]).toEqualTypeOf<VehicleFeelDef | undefined>();
  });

  it("rejects unknown and missing keys", () => {
    expect(VehicleFeelDefSchema.safeParse({ ...TRUNDLE, extra: 1 }).success).toBe(false);
    const rest: Partial<VehicleFeelDef> = { ...TRUNDLE };
    delete rest.springHz;
    expect(VehicleFeelDefSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects bad values and inverted ranges", () => {
    expect(VehicleFeelDefSchema.safeParse({ ...TRUNDLE, accelS: 0 }).success).toBe(false);
    expect(VehicleFeelDefSchema.safeParse({ ...TRUNDLE, handbrakeGripMult: 1.5 }).success).toBe(false);
    expect(VehicleFeelDefSchema.safeParse({ ...TRUNDLE, slideStartDeg: 10 }).success).toBe(false);
    expect(VehicleFeelDefSchema.safeParse({ ...TRUNDLE, travelM: 1 }).success).toBe(false);
  });

  it("requires vehicle.<id> keys, a schemaVersion and at least one vehicle", () => {
    expect(VehicleFeelTableSchema.safeParse({ schemaVersion: 1, vehicles: { "tool.x": TRUNDLE } }).success).toBe(false);
    expect(
      VehicleFeelTableSchema.safeParse({ schemaVersion: 2, vehicles: { "vehicle.trundle": TRUNDLE } }).success,
    ).toBe(false);
    expect(VehicleFeelTableSchema.safeParse({ schemaVersion: 1, vehicles: {} }).success).toBe(false);
  });
});
