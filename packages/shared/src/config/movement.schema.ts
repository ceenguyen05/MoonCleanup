// @contract config/movement.schema v1.3
// @consumers packages/game-data (data/movement.json), packages/sim (player motion: reads `SimConfig.feel`),
//   tools/balance-sim
//
// `movement.json`: on-foot speeds, jump and Hop Pack numbers, night penalty (progression-and-economy.md section 21),
// plus the on-foot feel tunables of game-feel-and-controls.md section 10.1 (sections 2.1 to 2.9).
//
// v1.1 (additive): optional `carryUnits`.
// v1.2 (breaking for data): `carryUnits` is required.
// v1.3 (breaking for data, no protocol/save impact; `GAME_DATA_SCHEMA_VERSION` stays 1 because packages/game-data, the
// only data source, supplies every key): the game-feel section 10.1 keys the sim implements are required. Only keys
// with a sim consumer today are added; the rest of section 10.1 (analogCurveExp, fallGravityMult, hopArrestFall,
// hopChainBelowUpMps, ballast.*, eyeHeightM, stepUpM, ladder, interact, throw, knockback, vehicle enter/exit) are added
// additively when their consumer lands. `slopeProbeM` is section 2.1's finite-difference half-distance (not in the
// section 10.1 table). `holsterSwapS` lives here as section 10.1 lists it.
// Feel keys are "Pacing: no" in section 10.1 except `hopMaxUpMps` / `hopMaxHorizontalMps` / `holsterSwapS`.

import { z } from "zod";
import {
  ElevationDegSchema,
  FracSchema,
  GameDataSchemaVersionSchema,
  NonNegativeNumberSchema,
  PositiveCountSchema,
  PositiveNumberSchema,
} from "./common.schema";

/** A positive multiplier that can only reduce (0 < x <= 1). */
const ReducingMultSchema = z.number().positive().max(1);

export const MovementSchema = z
  .strictObject({
    schemaVersion: GameDataSchemaVersionSchema,
    walkMps: PositiveNumberSchema,
    lopeMps: PositiveNumberSchema,
    sweepWalkMps: PositiveNumberSchema,
    jumpApexM: PositiveNumberSchema,
    hopBurstMps: PositiveNumberSchema,
    hopRechargeS: PositiveNumberSchema,
    nightPenaltyFrac: FracSchema,
    lampPenaltyReliefFrac: FracSchema,
    /** Pucks or stacks a player carries in hand (section 3). Required since v1.2. */
    carryUnits: PositiveCountSchema,

    // ---- v1.3: game-feel section 10.1 (ground, section 2.3) ----
    /** Ground acceleration up to walk speed, m/s^2. */
    groundAccelMps2: PositiveNumberSchema,
    /** Ground acceleration from walk to Lope, m/s^2. */
    lopeAccelMps2: PositiveNumberSchema,
    /** Release / slow-down deceleration, m/s^2. */
    groundDecelMps2: PositiveNumberSchema,
    /** Acceleration when the target opposes the velocity, m/s^2. */
    groundReverseAccelMps2: PositiveNumberSchema,
    /** Body yaw turn rate while not sweeping, degrees per second (sweeping: tool-feel `sweepFacingTurnDegPerS`). */
    facingTurnDegPerS: PositiveNumberSchema,
    /** Smallest analog target fraction once the stick is past the deadzone (section 2.2). */
    analogMinSpeedFrac: FracSchema,
    // ---- slopes (section 2.2) ----
    /** Uphill slowdown starts at this slope, degrees. */
    slopeSlowStartDeg: ElevationDegSchema,
    /** No traction (slide) above this slope, degrees; below 90. */
    slopeWalkMaxDeg: ElevationDegSchema,
    /** Uphill speed multiplier reached at `slopeWalkMaxDeg`. */
    slopeUphillMinMult: ReducingMultSchema,
    /** Sliding friction coefficient above `slopeWalkMaxDeg`. */
    slopeSlideFrictionFrac: FracSchema,
    /** Finite-difference half-distance for the ground slope, metres (section 2.1). */
    slopeProbeM: PositiveNumberSchema,
    // ---- jump, air, Touchdown (sections 2.4 and 2.5) ----
    /** Upward speed multiplier when jump is released early. */
    jumpCutVelocityMult: ReducingMultSchema,
    coyoteS: NonNegativeNumberSchema,
    jumpBufferS: NonNegativeNumberSchema,
    /** Gravity multiplier while Touchdown (descend) is held. */
    touchdownGravityMult: PositiveNumberSchema,
    airAccelMps2: NonNegativeNumberSchema,
    airBrakeMps2: NonNegativeNumberSchema,
    // ---- ground snap per sub-step (section 2.1) ----
    groundSnapSweepM: NonNegativeNumberSchema,
    groundSnapWalkM: NonNegativeNumberSchema,
    groundSnapLopeM: NonNegativeNumberSchema,
    /** Ground snap is off for this long after a jump, seconds. */
    groundSnapOffAfterJumpS: NonNegativeNumberSchema,
    // ---- landings (section 2.8): soft < landingSoftMps <= medium < landingHeavyMps <= heavy <= faceplantMps < Faceplant
    landingSoftMps: PositiveNumberSchema,
    landingHeavyMps: PositiveNumberSchema,
    faceplantMps: PositiveNumberSchema,
    landingMediumRecoveryS: NonNegativeNumberSchema,
    landingHeavyRecoveryS: NonNegativeNumberSchema,
    landingMediumAccelMult: ReducingMultSchema,
    landingHeavyAccelMult: ReducingMultSchema,
    faceplantMoveLockS: NonNegativeNumberSchema,
    faceplantJumpLockS: NonNegativeNumberSchema,
    // ---- Hop Pack (section 2.7; bursts per level stay in suit-gear.json) ----
    /** Burst direction, degrees from up toward the move direction. */
    hopBurstAngleDeg: ElevationDegSchema,
    hopMaxUpMps: PositiveNumberSchema,
    hopMaxHorizontalMps: PositiveNumberSchema,
    hopMinIntervalS: NonNegativeNumberSchema,
    // ---- body and integration (sections 2.1 and 2.9) ----
    capsuleRadiusM: PositiveNumberSchema,
    capsuleHeightM: PositiveNumberSchema,
    /** Sub-steps = clamp(ceil(|v| dt / substepMaxDispM), substepsMin, substepsMax). */
    substepMaxDispM: PositiveNumberSchema,
    substepsMin: PositiveCountSchema,
    substepsMax: PositiveCountSchema,
    // ---- tools in hand (section 3.2) ----
    holsterSwapS: NonNegativeNumberSchema,
  })
  .superRefine((m, ctx) => {
    const issue = (path: string, message: string): void => {
      ctx.addIssue({ code: "custom", message, path: [path] });
    };
    if (m.slopeSlowStartDeg >= m.slopeWalkMaxDeg) issue("slopeSlowStartDeg", "must be below slopeWalkMaxDeg");
    if (m.slopeWalkMaxDeg >= 90) issue("slopeWalkMaxDeg", "must be below 90");
    if (m.landingSoftMps >= m.landingHeavyMps) issue("landingSoftMps", "must be below landingHeavyMps");
    if (m.landingHeavyMps >= m.faceplantMps) issue("landingHeavyMps", "must be below faceplantMps");
    if (m.substepsMin > m.substepsMax) issue("substepsMin", "must not exceed substepsMax");
    if (m.capsuleHeightM < 2 * m.capsuleRadiusM) issue("capsuleHeightM", "must be at least 2 x capsuleRadiusM");
  });
export type MovementTable = z.infer<typeof MovementSchema>;
