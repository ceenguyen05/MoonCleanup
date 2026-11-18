// @contract config/vehicle-feel.schema v1
// @consumers packages/game-data (src/vehicle-feel.ts: the Trundle table, validated at load), packages/sim
//   (vehicles/handling.ts: reads `VEHICLE_FEEL` instead of its local `VEHICLE_HANDLING`), tools/balance-sim
//
// Vehicle handling feel (game-feel-and-controls.md section 5.2): spring f / zeta, acceleration times, grip, turn caps,
// probe layout. Economy numbers (price, cruise, boost, width, payload) stay in `vehicles.json`; these are the numbers the
// vehicles contract has no field for. Additive: NOT part of `GameDataBundleSchema` (no new required bundle key, so
// `GAME_DATA_SCHEMA_VERSION` and every existing bundle consumer are unchanged). Keyed by game-data vehicle id.
// Units: metres, seconds, degrees; field names carry the unit.

import { z } from "zod";
import {
  GameDataIdSchema,
  GameDataSchemaVersionSchema,
  NonNegativeNumberSchema,
  PositiveNumberSchema,
} from "./common.schema";

const Triple = z.tuple([z.number(), z.number(), z.number()]);

/** Handling of one vehicle (same field set and units as the sim's former `VehicleHandlingDef`). */
export const VehicleFeelDefSchema = z
  .strictObject({
    /** Probe mounts in the body frame, metres (index 0 front drum, 1 left wheel, 2 right wheel). */
    probeForwardM: Triple,
    probeRightM: Triple,
    restLengthM: PositiveNumberSchema,
    travelM: PositiveNumberSchema,
    wheelRadiusM: PositiveNumberSchema,
    /** Visual body spring: natural frequency Hz, damping ratio. */
    springHz: PositiveNumberSchema,
    springZeta: PositiveNumberSchema,
    /** Seconds from 0 to cruise. */
    accelS: PositiveNumberSchema,
    brakeMps2: PositiveNumberSchema,
    coastMps2: NonNegativeNumberSchema,
    reverseMps: NonNegativeNumberSchema,
    /** Turn rate cap, degrees per second, moving / turning in place. */
    turnDegPerS: PositiveNumberSchema,
    turnInPlaceDegPerS: PositiveNumberSchema,
    /** Below this speed the in-place turn rate applies, m/s. */
    inPlaceSpeedMps: NonNegativeNumberSchema,
    /** Lateral velocity decay rate, 1/s; the handbrake multiplies it. */
    gripPerS: PositiveNumberSchema,
    handbrakeGripMult: z.number().min(0).max(1),
    /** Steering input follow rate, full lock per second. */
    steerRatePerS: PositiveNumberSchema,
    /** Ground snap distance, metres. */
    groundSnapM: NonNegativeNumberSchema,
    /** Boost meter: full duration s, regeneration delay s, regeneration speed (s of boost per s). */
    boostMeterS: NonNegativeNumberSchema,
    boostRegenDelayS: NonNegativeNumberSchema,
    boostRegenPerS: NonNegativeNumberSchema,
    /** Traction fades linearly between these local slopes (degrees); above the second it slides. */
    tractionFadeStartDeg: z.number().min(0).max(90),
    slideStartDeg: z.number().min(0).max(90),
    slideFriction: z.number().min(0).max(1),
    /** Cleaning intake drum ahead of the chassis centre, metres. */
    drumForwardM: NonNegativeNumberSchema,
    /** Walk-behind handle behind the chassis centre, metres. */
    handleBackM: NonNegativeNumberSchema,
    /** How close an avatar must be to enter, metres. */
    enterReachM: PositiveNumberSchema,
    /**
     * Hopper tip at a Dump Plate: seconds from the stop to the dust leaving the hopper, before Fast Tip
     * (`vehicleUnloadTimeMult`). Added 2026-11-17 (M1-W7-T01, all 7 upgrade lines in scope); additive within v1.
     */
    tipS: PositiveNumberSchema,
  })
  .superRefine((v, ctx) => {
    // Sim divides by the front-drum to wheel distance (centerWeightDrum, wheelBase); equal offsets give Infinity/NaN.
    if (v.probeForwardM[0] === v.probeForwardM[1]) {
      ctx.addIssue({ code: "custom", message: "must differ from probeForwardM[1]", path: ["probeForwardM", 0] });
    }
    if (v.slideStartDeg < v.tractionFadeStartDeg) {
      ctx.addIssue({ code: "custom", message: "must be at least tractionFadeStartDeg", path: ["slideStartDeg"] });
    }
    if (v.travelM > v.restLengthM) {
      ctx.addIssue({ code: "custom", message: "must not exceed restLengthM", path: ["travelM"] });
    }
  });
export type VehicleFeelDef = z.infer<typeof VehicleFeelDefSchema>;

/** `{ schemaVersion, vehicles: { "vehicle.<id>": VehicleFeelDef } }`; every key must be a `vehicle.` id. */
export const VehicleFeelTableSchema = z
  .strictObject({
    schemaVersion: GameDataSchemaVersionSchema,
    vehicles: z.record(GameDataIdSchema, VehicleFeelDefSchema),
  })
  .superRefine((t, ctx) => {
    for (const id of Object.keys(t.vehicles)) {
      if (!id.startsWith("vehicle.")) {
        ctx.addIssue({ code: "custom", message: "must be a vehicle.<id>", path: ["vehicles", id] });
      }
    }
    if (Object.keys(t.vehicles).length === 0) {
      ctx.addIssue({ code: "custom", message: "must define at least one vehicle", path: ["vehicles"] });
    }
  });
export type VehicleFeelTable = z.infer<typeof VehicleFeelTableSchema>;
