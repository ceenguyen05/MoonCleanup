// Vehicle handling feel table (game-feel-and-controls.md section 5.2), moved out of sim's `vehicles/handling.ts`.
// Validated at module load by `VehicleFeelTableSchema` (shared config/vehicle-feel.schema v1) and deep-frozen. Economy
// numbers stay in `data/vehicles.json`; keys here are the same `vehicle.<id>` ids. Only the Trundle (MVP) is defined; the
// Skiff, Carryall, Bulldust and Behemoth are M2. Pure: no DOM, no Node, no three.
import { VehicleFeelTableSchema, type VehicleFeelDef } from "@moon-cleanup/shared";

export type { VehicleFeelDef };

const RAW_VEHICLE_FEEL = {
  schemaVersion: 1,
  vehicles: {
    "vehicle.trundle": {
      probeForwardM: [0.55, -0.35, -0.35],
      probeRightM: [0, -0.55, 0.55],
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
      // Hopper tip time before Fast Tip (-40 % / -70 %: 1.2 s / 0.6 s). Provisional feel value; game-designer confirms.
      tipS: 2.0,
    },
  },
};

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Parses a vehicle-feel table; throws one error listing every issue path. */
export function parseVehicleFeel(raw: unknown): Readonly<Record<string, VehicleFeelDef>> {
  const result = VehicleFeelTableSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new Error(`vehicle-feel failed validation:\n${lines.join("\n")}`);
  }
  return deepFreeze(result.data.vehicles);
}

/** Handling feel by `vehicle.<id>`; same shape and values as sim's former `VEHICLE_HANDLING`. */
export const VEHICLE_FEEL: Readonly<Record<string, VehicleFeelDef>> = parseVehicleFeel(RAW_VEHICLE_FEEL);
