// Vehicle handling constants (game-feel-and-controls.md section 5.2 table, section 5.2 notes, E section 8).
//
// Economy numbers (price, cruise, boost, cleaning width, payload, upgrade lines) come from `vehicles.json` and
// `vehicle-upgrades.json` through `resolveVehicleTuning`. The numbers here are HANDLING FEEL (spring f / zeta, acceleration
// times, grip, turn caps, probe layout) that the spec fixes per vehicle but the game-data contract (config/vehicles.schema
// v1.1) has no field for. They are quarantined in this one table, keyed by game-data vehicle id, so moving them into a
// `vehicle-feel` game-data table later is a one-file change (open item for contracts-architect, see the W7-T01 report).
// Only the Trundle (MVP) is defined; the Skiff, Carryall, Bulldust and Behemoth are M2.

/** Handling of one vehicle, in metres, seconds and degrees (resolved to sim units by `resolveVehicleTuning`). */
export interface VehicleHandlingDef {
  /** Probe mounts in the body frame: forward / right offsets in metres (index 0 = front drum, 1 = left wheel, 2 = right wheel). */
  readonly probeForwardM: readonly [number, number, number];
  readonly probeRightM: readonly [number, number, number];
  readonly restLengthM: number;
  readonly travelM: number;
  readonly wheelRadiusM: number;
  /** Visual body spring (natural frequency Hz, damping ratio). */
  readonly springHz: number;
  readonly springZeta: number;
  /** Seconds from 0 to cruise. */
  readonly accelS: number;
  readonly brakeMps2: number;
  readonly coastMps2: number;
  readonly reverseMps: number;
  /** Turn rate cap, degrees per second, moving / turning in place. */
  readonly turnDegPerS: number;
  readonly turnInPlaceDegPerS: number;
  /** Below this speed the in-place turn rate applies. */
  readonly inPlaceSpeedMps: number;
  /** Lateral velocity decay rate, 1/s; the handbrake multiplies it. */
  readonly gripPerS: number;
  readonly handbrakeGripMult: number;
  /** Steering input follow rate (units of full lock per second). */
  readonly steerRatePerS: number;
  /** Ground snap distance (a Trundle does not leave the ground below this drop), metres. */
  readonly groundSnapM: number;
  /** Boost meter: full duration, regeneration delay, regeneration speed (seconds of boost per second). */
  readonly boostMeterS: number;
  readonly boostRegenDelayS: number;
  readonly boostRegenPerS: number;
  /** Steep: traction fades linearly between these local slopes (degrees); above the second it slides. */
  readonly tractionFadeStartDeg: number;
  readonly slideStartDeg: number;
  readonly slideFriction: number;
  /** Cleaning intake: drum position ahead of the chassis centre, metres. */
  readonly drumForwardM: number;
  /** Walk-behind handle: where the driver stands behind the chassis centre, metres. */
  readonly handleBackM: number;
  /** How close an avatar must be to enter (the handle), metres. */
  readonly enterReachM: number;
}

export const VEHICLE_HANDLING: Readonly<Record<string, VehicleHandlingDef>> = Object.freeze({
  "vehicle.trundle": Object.freeze({
    probeForwardM: [0.55, -0.35, -0.35] as const,
    probeRightM: [0, -0.55, 0.55] as const,
    restLengthM: 0.18,
    travelM: 0.05,
    wheelRadiusM: 0.2,
    springHz: 3.0,
    springZeta: 0.5,
    accelS: 1.0,
    brakeMps2: 6.0,
    coastMps2: 2.0,
    reverseMps: 1.5,
    turnDegPerS: 120,
    turnInPlaceDegPerS: 90,
    inPlaceSpeedMps: 0.2,
    gripPerS: 20,
    handbrakeGripMult: 0.35,
    steerRatePerS: 8,
    groundSnapM: 0.4,
    boostMeterS: 4.0,
    boostRegenDelayS: 1.0,
    boostRegenPerS: 0.5,
    tractionFadeStartDeg: 20,
    slideStartDeg: 25,
    slideFriction: 0.2,
    drumForwardM: 0.55,
    handleBackM: 0.9,
    enterReachM: 2.5,
  }),
});

/** Fixed sub-steps per tick for spring stability (game-feel section 2.1: vehicles use 4). */
export const VEHICLE_SUBSTEPS = 4;
