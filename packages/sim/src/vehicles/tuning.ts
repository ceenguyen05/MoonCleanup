// Vehicle tuning resolved once from the validated game-data bundle (`vehicles.json`, `vehicle-upgrades.json`,
// `economy.json`) plus the game-data handling-feel table (`VEHICLE_FEEL`, re-exported by ./handling). Hot paths read
// `VehicleKindTuning` / `VehicleStats`, never the raw bundle. Upgrade semantics (config/common.schema `NumericEffectSchema`): owning level N activates level N's effects and
// deactivates the levels below it, so each line contributes only its current level.

import type { GameData } from "@moon-cleanup/game-data";
import type { SimConfig } from "../config/sim-config";
import { VEHICLE_HANDLING, type VehicleHandlingDef } from "./handling";

/** Spec stat ids written by `vehicle-upgrades.json` (and the Board's vehicle nodes). */
export const VEHICLE_STAT = {
  speedMult: "vehicleSpeedMult",
  widthMult: "vehicleWidthMult",
  payloadMult: "payloadKgMult",
  boostMult: "boostMult",
  tripTimeMult: "vehicleTripTimeMult",
  unloadTimeMult: "vehicleUnloadTimeMult",
  cruiseControl: "cruiseControl",
  lampRangeM: "vehicleLampRangeM",
  nightPenaltyRelief: "vehicleNightPenaltyRelief",
} as const;

export interface VehicleLineEffect {
  readonly stat: string;
  readonly op: "add" | "mul" | "set";
  readonly value: number;
}

export interface VehicleUpgradeLineTuning {
  readonly code: number;
  readonly id: string;
  /** Per level (index 0 = level 1). */
  readonly costMult: readonly number[];
  readonly effects: readonly (readonly VehicleLineEffect[])[];
  /** Some level of the line changes the cleaning width: its speed multiplier applies only while the intake is down. */
  readonly intakeBound: boolean;
}

/** Handling resolved to sim units (ticks, rates per tick-second). */
export interface VehicleHandling {
  readonly def: VehicleHandlingDef;
  readonly accelMps2PerCruise: number;
  readonly turnRadPerS: number;
  readonly turnInPlaceRadPerS: number;
  readonly tanTractionFade: number;
  readonly tanSlideStart: number;
  /** Boost meter in milliseconds (integer arithmetic). */
  readonly boostMeterMs: number;
  readonly boostRegenDelayMs: number;
  readonly boostRegenMsPerTick: number;
  readonly boostDrainMsPerTick: number;
  readonly omega: number;
  /** Weight of the drum probe in the plane height at the chassis point (symmetric wheel layout: wheels share the rest). */
  readonly centerWeightDrum: number;
  /** Hopper tip at a Dump Plate before Fast Tip, ticks (feel `tipS`). */
  readonly tipTicks: number;
}

export interface VehicleKindTuning {
  /** Index in the game-data vehicle table (also the stroke tool-code offset). */
  readonly code: number;
  readonly id: string;
  readonly tier: number;
  readonly priceLm: number;
  readonly seats: number;
  readonly widthM: number;
  readonly cruiseMps: number;
  readonly boostMult: number;
  readonly depthLevels: number;
  readonly payloadGrams: number;
  readonly puckSlots: number;
  /** Indices into `VehicleTuning.lines`. */
  readonly lineCodes: readonly number[];
  /** True when the vehicle cleans (width > 0). */
  readonly cleans: boolean;
  /** Handling, or null for vehicles whose handling is not implemented yet (M2). */
  readonly handling: VehicleHandling | null;
}

export interface MotorPoolTuning {
  readonly priceLm: number;
  readonly includedDumpPlates: number;
  readonly dumpPlatePriceLm: number;
  readonly dustVaultPriceLm: number;
  readonly dustVaultStoreGrams: number;
}

export interface VehicleTuning {
  readonly kinds: readonly VehicleKindTuning[];
  readonly lines: readonly VehicleUpgradeLineTuning[];
  readonly vehiclesOutPerMotorPool: number;
  readonly motorPool: MotorPoolTuning;
  /** Repeat Requisition: further copies of a vehicle (and its upgrades) cost this fraction of list. */
  readonly repeatFrac: number;
  /** Stroke tool code of vehicle kind k = `strokeToolCodeBase + k`. */
  readonly strokeToolCodeBase: number;
}

/** Resolved stats of one vehicle with its upgrade levels applied. */
export class VehicleStats {
  cruiseMps = 0;
  /** Cruise multiplier that is always on (Gear Ratio). */
  speedMult = 1;
  /** Cruise multiplier that applies only while the intake is down (Wide Mouth). */
  intakeSpeedMult = 1;
  boostMult = 1;
  widthM = 0;
  payloadGrams = 0;
  /** Balance-model round-trip multiplier (Afterburner, Throttle Lock, Fast Tip); the sim gets those effects for real. */
  tripTimeMult = 1;
  /** Hopper tip time multiplier (Fast Tip). */
  unloadTimeMult = 1;
  /** Hopper tip at a Dump Plate, ticks (the kind's tip time x `unloadTimeMult`, at least 1). */
  tipTicks = 1;
  cruiseControl = false;
  /** Running Lamps beam range, metres (0 = no Running Lamps: the lights key does nothing). */
  lampRangeM = 0;
  /** Night penalty points the Running Lamps remove while the lights are on. */
  nightPenaltyRelief = 0;
}

function numberParam(params: Readonly<Record<string, unknown>> | undefined, key: string): number {
  const v = params?.[key];
  return typeof v === "number" ? v : 0;
}

function resolveHandling(def: VehicleHandlingDef, cfg: SimConfig): VehicleHandling {
  const deg = Math.PI / 180;
  const ms = cfg.stepMs;
  return Object.freeze({
    def,
    accelMps2PerCruise: 1 / def.accelS,
    turnRadPerS: def.turnDegPerS * deg,
    turnInPlaceRadPerS: def.turnInPlaceDegPerS * deg,
    // Config time only (never on a tick path), like the hop angle cos / sin in sim-config.
    tanTractionFade: Math.tan(def.tractionFadeStartDeg * deg),
    tanSlideStart: Math.tan(def.slideStartDeg * deg),
    boostMeterMs: Math.round(def.boostMeterS * 1000),
    boostRegenDelayMs: Math.round(def.boostRegenDelayS * 1000),
    boostRegenMsPerTick: Math.round(def.boostRegenPerS * ms),
    boostDrainMsPerTick: ms,
    omega: 2 * Math.PI * def.springHz,
    // Chassis point (0, 0) as a barycentric mix of drum (df, 0) and wheels (-bf, +-r): weights a, (1-a)/2, (1-a)/2.
    centerWeightDrum: -def.probeForwardM[1] / (def.probeForwardM[0] - def.probeForwardM[1]),
    tipTicks: Math.max(1, Math.round(def.tipS * cfg.tickHz)),
  });
}

/**
 * Builds the vehicle tuning from the validated bundle and the sim config (tick rate). `feel` = the handling-feel table
 * (default: game-data `VEHICLE_FEEL`; tests and balance-sim may pass a `parseVehicleFeel` result). Config time only.
 */
export function resolveVehicleTuning(
  data: GameData,
  cfg: SimConfig,
  feel: Readonly<Record<string, VehicleHandlingDef>> = VEHICLE_HANDLING,
): VehicleTuning {
  const table = data.vehicles;
  const lines: VehicleUpgradeLineTuning[] = data["vehicle-upgrades"].lines.map((line, code) => {
    const effects = line.levels.map((level) => {
      const list: VehicleLineEffect[] = [];
      for (const e of level.effects) if ("stat" in e) list.push({ stat: e.stat, op: e.op, value: e.value });
      return Object.freeze(list);
    });
    return Object.freeze({
      code,
      id: line.id,
      costMult: Object.freeze(line.levels.map((l) => l.costMultOfVehiclePrice)),
      effects: Object.freeze(effects),
      intakeBound: effects.some((lvl) => lvl.some((e) => e.stat === VEHICLE_STAT.widthMult)),
    });
  });
  const lineIndex = new Map(lines.map((l) => [l.id, l.code]));
  const kinds: VehicleKindTuning[] = table.vehicles.map((v, code) => {
    const def = feel[v.id];
    return Object.freeze({
      code,
      id: v.id,
      tier: v.tier,
      priceLm: v.priceLm,
      seats: v.seats,
      widthM: v.widthM,
      cruiseMps: v.cruiseMps,
      boostMult: v.boostMult,
      depthLevels: v.depthLevels,
      payloadGrams: Math.round(v.payloadKg * 1000),
      puckSlots: v.puckSlots,
      lineCodes: Object.freeze(v.upgradeLineIds.map((id) => lineIndex.get(id) ?? -1).filter((c) => c >= 0)),
      cleans: v.widthM > 0,
      handling: def ? resolveHandling(def, cfg) : null,
    });
  });
  const part = (id: string) => table.motorPoolParts.find((p) => p.id === id);
  const pool = part("piece.motor_pool");
  const vault = part("piece.dust_vault");
  return Object.freeze({
    kinds: Object.freeze(kinds),
    lines: Object.freeze(lines),
    vehiclesOutPerMotorPool: table.vehiclesOutPerMotorPool,
    motorPool: Object.freeze({
      priceLm: pool?.priceLm ?? 0,
      includedDumpPlates: numberParam(pool?.params, "includedDumpPlates"),
      dumpPlatePriceLm: part("piece.dump_plate")?.priceLm ?? 0,
      dustVaultPriceLm: vault?.priceLm ?? 0,
      dustVaultStoreGrams: Math.round(numberParam(vault?.params, "storeKg") * 1000),
    }),
    repeatFrac: data.economy.repeatRequisitionFrac,
    strokeToolCodeBase: cfg.tools.length,
  });
}

/** Index of the vehicle kind with `id`, or -1. */
export function vehicleKindOf(tuning: VehicleTuning, id: string): number {
  for (const k of tuning.kinds) if (k.id === id) return k.code;
  return -1;
}

/**
 * Applies the upgrade `levels` (one entry per `tuning.lines` index, 0 = not owned; lines the kind does not offer are
 * ignored) to the kind's base numbers and writes the result into `out`. Allocation-free.
 */
export function resolveVehicleStats(
  tuning: VehicleTuning,
  kind: VehicleKindTuning,
  levels: ArrayLike<number>,
  out: VehicleStats,
): VehicleStats {
  out.cruiseMps = kind.cruiseMps;
  out.speedMult = 1;
  out.intakeSpeedMult = 1;
  out.boostMult = kind.boostMult;
  let widthMult = 1;
  let payloadMult = 1;
  out.tripTimeMult = 1;
  out.unloadTimeMult = 1;
  out.cruiseControl = false;
  out.lampRangeM = 0;
  out.nightPenaltyRelief = 0;
  const lc = kind.lineCodes;
  for (let i = 0; i < lc.length; i++) {
    const line = tuning.lines[lc[i]!]!;
    const level = levels[line.code] ?? 0;
    if (level <= 0) continue;
    const effects = line.effects[Math.min(level, line.effects.length) - 1]!;
    for (let j = 0; j < effects.length; j++) {
      const e = effects[j]!;
      const v = e.value;
      switch (e.stat) {
        case VEHICLE_STAT.speedMult:
          if (line.intakeBound) out.intakeSpeedMult = applyOp(out.intakeSpeedMult, e.op, v);
          else out.speedMult = applyOp(out.speedMult, e.op, v);
          break;
        case VEHICLE_STAT.widthMult:
          widthMult = applyOp(widthMult, e.op, v);
          break;
        case VEHICLE_STAT.payloadMult:
          payloadMult = applyOp(payloadMult, e.op, v);
          break;
        case VEHICLE_STAT.boostMult:
          out.boostMult = applyOp(out.boostMult, e.op, v);
          break;
        case VEHICLE_STAT.tripTimeMult:
          out.tripTimeMult = applyOp(out.tripTimeMult, e.op, v);
          break;
        case VEHICLE_STAT.unloadTimeMult:
          out.unloadTimeMult = applyOp(out.unloadTimeMult, e.op, v);
          break;
        case VEHICLE_STAT.cruiseControl:
          out.cruiseControl = v > 0;
          break;
        case VEHICLE_STAT.lampRangeM:
          out.lampRangeM = applyOp(out.lampRangeM, e.op, v);
          break;
        case VEHICLE_STAT.nightPenaltyRelief:
          out.nightPenaltyRelief = applyOp(out.nightPenaltyRelief, e.op, v);
          break;
        default:
          break;
      }
    }
  }
  out.widthM = kind.widthM * widthMult;
  out.payloadGrams = Math.round(kind.payloadGrams * payloadMult);
  const tip = kind.handling ? Math.round(kind.handling.tipTicks * out.unloadTimeMult) : 1;
  out.tipTicks = tip < 1 ? 1 : tip;
  return out;
}

function applyOp(current: number, op: "add" | "mul" | "set", value: number): number {
  return op === "mul" ? current * value : op === "add" ? current + value : value;
}
