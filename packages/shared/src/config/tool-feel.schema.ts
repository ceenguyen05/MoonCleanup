// @contract config/tool-feel.schema v1.1
// @consumers packages/game-data (data/tool-feel.json), packages/sim (tool head, strokes, Dust Cell warnings:
//   reads `SimConfig.toolFeel`; puck feel reads `SimConfig.cargo`), apps/client (prediction reads the same SimConfig;
//   `bandPerStackS` is presentation), tools/balance-sim
//
// v1.1 (2026-11-15, additive keys, all required): Dust Puck feel `formPuckHoldS, bandPerStackS, throwMinMps,
// throwMaxMps, throwChargeS, throwPitchDeg, throwHeightM, puckSkidDecelMps2, pickupRadiusM, puckMergeRadiusM,
// puckDropForwardM` (section 10.1/10.2). Puck mass, stack max, loose caps and despawn stay in `dust-cells.json`; carry
// count in `movement.carryUnits`. Rule: `throwMaxMps >= throwMinMps`. `GAME_DATA_SCHEMA_VERSION` stays 1.
//
// `tool-feel.json` (new in contract v1.3): hand-tool feel tunables of game-feel-and-controls.md section 10.2
// (sections 3.1 to 3.6). Balance numbers per tool (width, Depth, reach, `strokeS`, Cell size) stay in `tools.json`.
//
// Push length L (section 3.1 gap-free rule): L = strokeLengthStrideFrac x vMax x strokeS + strokeLengthPadM, with
// vMax = strokeLengthMaxSweepMps (x the Lane Lock `sweepSpeedMult` for that tool). Section 10.2 lists the resulting
// per-tool `strokeLengthM` values rounded to cm (desk_duster 0.45 ... ion_curtain 0.94); the table stores the rule so
// L follows `strokeS` and Lane Lock automatically and the sim keeps the unrounded L it was validated with.
// `strokeLengthMaxSweepMps` is the fastest sweep-walk with every bonus (2.96 m/s, section 2.3 table); it must be at
// least `movement.sweepWalkMps` (bundle rule) — balance-reviewer re-checks it when sweep-speed bonuses change.
//
// Only keys with a sim consumer today are present; the rest of section 10.2 (aim pitch, fixed-aim reach, Detailing
// interval, precision aim, Lane Guide, puck forming, pour, micro-kick) is added additively when its consumer lands.

import { z } from "zod";
import {
  FracSchema,
  GameDataSchemaVersionSchema,
  NonNegativeNumberSchema,
  PositiveNumberSchema,
} from "./common.schema";

export const ToolFeelSchema = z
  .strictObject({
    schemaVersion: GameDataSchemaVersionSchema,
    /** Contact share of one stroke cycle (the rest lifts the head back), 0 < x <= 1. */
    contactFrac: z.number().positive().max(1),
    /** L = strokeLengthStrideFrac x vMax x strokeS + strokeLengthPadM (section 3.1). */
    strokeLengthStrideFrac: FracSchema,
    strokeLengthPadM: NonNegativeNumberSchema,
    /** vMax of the gap-free rule: fastest sweep-walk with every bonus, m/s. */
    strokeLengthMaxSweepMps: PositiveNumberSchema,
    /** Smallest aim distance = L + bootClearanceM. */
    bootClearanceM: NonNegativeNumberSchema,
    /** Head lifts above this ground speed ... */
    headSpeedLiftMps: PositiveNumberSchema,
    /** ... and drops again below this one (hysteresis; below `headSpeedLiftMps`). */
    headSpeedResumeMps: PositiveNumberSchema,
    /** Body yaw turn rate while sweeping or Detailing, degrees per second. */
    sweepFacingTurnDegPerS: PositiveNumberSchema,
    /** Body speed multiplier while Detailing is held. */
    detailingMoveMult: z.number().positive().max(1),
    /** Crescent Squeegee Flick: strokes continue while airborne up to this feet height, metres. */
    flickMaxFeetHeightM: NonNegativeNumberSchema,
    /** Dust Cell near-full warning threshold (section 3.6). */
    cellNearFullFrac: FracSchema,
    /** Dust Puck feel (section 3.6, 10.1/10.2; v1.1). F held this long bands the whole Cell into Puck Stacks, s. */
    formPuckHoldS: PositiveNumberSchema,
    /** Presentation only (client): time per banded stack's visual, s. The sim bands instantly. */
    bandPerStackS: NonNegativeNumberSchema,
    /** Throw (hold Q, release): speed = min + (max - min) x clamp(heldS / throwChargeS), m/s. */
    throwMinMps: PositiveNumberSchema,
    throwMaxMps: PositiveNumberSchema,
    throwChargeS: PositiveNumberSchema,
    /** Fixed launch pitch above the camera heading, degrees (0 < x < 90). */
    throwPitchDeg: z.number().positive().lt(90),
    /** Release height of a throw above the feet, m. */
    throwHeightM: NonNegativeNumberSchema,
    /** Landed pucks skid at this deceleration, m/s^2. */
    puckSkidDecelMps2: PositiveNumberSchema,
    /** Q pickup radius around the feet, m. */
    pickupRadiusM: PositiveNumberSchema,
    /** Resting loose pucks closer than this merge on touch (combined <= stackMaxKg); 0 disables, m. */
    puckMergeRadiusM: NonNegativeNumberSchema,
    /** A formed or dropped puck lands this far in front of the feet, m. */
    puckDropForwardM: NonNegativeNumberSchema,
  })
  .superRefine((t, ctx) => {
    if (t.headSpeedResumeMps >= t.headSpeedLiftMps) {
      ctx.addIssue({ code: "custom", message: "must be below headSpeedLiftMps", path: ["headSpeedResumeMps"] });
    }
    if (t.throwMaxMps < t.throwMinMps) {
      ctx.addIssue({ code: "custom", message: "must be at least throwMinMps", path: ["throwMaxMps"] });
    }
  });
export type ToolFeelTable = z.infer<typeof ToolFeelSchema>;
