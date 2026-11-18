// Vehicle handling feel (game-feel-and-controls.md section 5.2 table, section 5.2 notes, E section 8).
//
// Economy numbers (price, cruise, boost, cleaning width, payload, upgrade lines) come from `vehicles.json` and
// `vehicle-upgrades.json` through `resolveVehicleTuning`. HANDLING FEEL (spring f / zeta, acceleration times, grip, turn
// caps, probe layout, handle / drum / reach offsets) is the data-driven `VEHICLE_FEEL` table in packages/game-data
// (`src/vehicle-feel.ts`, validated by shared `config/vehicle-feel.schema` v1 at load and deep-frozen), keyed by game-data
// vehicle id. The sim holds no handling numbers of its own; `resolveVehicleTuning` reads the table once at config time.
// Only the Trundle (MVP) is defined; the Skiff, Carryall, Bulldust and Behemoth are M2.

import { VEHICLE_FEEL, type VehicleFeelDef } from "@moon-cleanup/game-data";

/** Handling of one vehicle, in metres, seconds and degrees (resolved to sim units by `resolveVehicleTuning`). */
export type VehicleHandlingDef = VehicleFeelDef;

/** Handling feel by `vehicle.<id>`: the game-data `VEHICLE_FEEL` table (same object, frozen). */
export const VEHICLE_HANDLING: Readonly<Record<string, VehicleHandlingDef>> = VEHICLE_FEEL;

/** Fixed sub-steps per tick for spring stability (game-feel section 2.1: vehicles use 4). */
export const VEHICLE_SUBSTEPS = 4;
