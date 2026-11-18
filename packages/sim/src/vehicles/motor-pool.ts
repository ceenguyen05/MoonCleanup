// Motor Pool: the garage that spawns, recalls and upgrades vehicles (progression-and-economy.md section 21).
//
// Shift-wide state (the wallet is shared): how many Motor Pools are built, copies bought per kind, upgrade levels per
// (kind, line). Each Motor Pool lets `vehiclesOutPerMotorPool` vehicles be out at once. Prices come from game-data; the
// Repeat Requisition rule makes further copies of a vehicle (and the upgrades of those copies) cost `repeatFrac` of list.
// The host (the room) owns the wallet: it calls the `quote*` functions, charges, then calls the matching `buy*` mutator.
// Everything here is integer state and allocation-free after construction.

import { discountedPriceLm } from "../economy/purchase";
import type { SimConfig } from "../config/sim-config";
import type { SimGround } from "../movement/avatar";
import { dumpHopper, type HopperSink } from "./intake";
import type { VehicleTuning } from "./tuning";
import { refreshVehicleStats, spawnVehicle, VehicleState } from "./vehicle";

/** Reject codes (negative results of spawn). */
export const MP_NO_MOTOR_POOL = -1;
export const MP_NOT_OWNED = -2;
export const MP_LIMIT_OUT = -3;
export const MP_NO_FREE_SLOT = -4;
export const MP_ALREADY_OUT = -5;

/** Fixed pool of vehicle entities of a room. */
export class VehicleStore {
  readonly vehicles: VehicleState[];

  constructor(capacity: number, lineCount: number) {
    this.vehicles = [];
    for (let k = 0; k < capacity; k++) this.vehicles.push(new VehicleState(lineCount));
  }

  /** Vehicles currently out. */
  activeCount(): number {
    let n = 0;
    for (const v of this.vehicles) if (v.active) n++;
    return n;
  }

  /** Store index of the active vehicle of `kindCode` owned by `slot`, or -1. */
  indexOfOwner(slot: number, kindCode: number): number {
    for (let k = 0; k < this.vehicles.length; k++) {
      const v = this.vehicles[k]!;
      if (v.active && v.ownerSlot === slot && v.kindCode === kindCode) return k;
    }
    return -1;
  }
}

export class MotorPoolState {
  /** Motor Pools built in the shift. */
  poolsBuilt = 0;
  /** Copies bought per vehicle kind. */
  readonly copies: Uint8Array;
  /** Upgrade level per (kind, line), index kind * lineCount + line. */
  readonly levels: Uint8Array;
  private readonly lineCount: number;

  constructor(tuning: VehicleTuning) {
    this.lineCount = tuning.lines.length;
    this.copies = new Uint8Array(tuning.kinds.length);
    this.levels = new Uint8Array(tuning.kinds.length * this.lineCount);
  }

  levelOf(kindCode: number, lineCode: number): number {
    return this.levels[kindCode * this.lineCount + lineCode]!;
  }

  /** Vehicles allowed out at once. */
  maxOut(tuning: VehicleTuning): number {
    return this.poolsBuilt * tuning.vehiclesOutPerMotorPool;
  }
}

// ---- Prices ----

/** Price of the next copy of a vehicle: list for the first, Repeat Requisition for further copies, after the Rebate. */
export function quoteVehicleLm(
  tuning: VehicleTuning,
  pool: MotorPoolState,
  kindCode: number,
  rebateFrac: number,
): number {
  const kind = tuning.kinds[kindCode]!;
  const list = pool.copies[kindCode]! > 0 ? Math.round(kind.priceLm * tuning.repeatFrac) : kind.priceLm;
  return discountedPriceLm(list, rebateFrac);
}

/** Price of the next level of `lineCode` for `kindCode`; -1 when the kind does not offer the line or it is maxed. */
export function quoteUpgradeLm(
  tuning: VehicleTuning,
  pool: MotorPoolState,
  kindCode: number,
  lineCode: number,
  rebateFrac: number,
): number {
  const kind = tuning.kinds[kindCode]!;
  const line = tuning.lines[lineCode];
  if (!line || !kind.lineCodes.includes(lineCode)) return -1;
  const level = pool.levelOf(kindCode, lineCode);
  if (level >= line.costMult.length) return -1;
  const base = kind.priceLm * line.costMult[level]!;
  const list = pool.copies[kindCode]! > 1 ? Math.round(base * tuning.repeatFrac) : Math.round(base);
  return discountedPriceLm(list, rebateFrac);
}

// ---- Purchases (the host charges the wallet first) ----

export function buildMotorPool(pool: MotorPoolState): void {
  pool.poolsBuilt++;
}

/** Vehicles need a Motor Pool (an ordinary prerequisite). False when none is built. */
export function buyVehicle(pool: MotorPoolState, kindCode: number): boolean {
  if (pool.poolsBuilt <= 0 || pool.copies[kindCode]! >= 255) return false;
  pool.copies[kindCode]!++;
  return true;
}

/** Applies one upgrade level and refreshes every vehicle of the kind that is out. False when not purchasable. */
export function buyUpgrade(
  tuning: VehicleTuning,
  pool: MotorPoolState,
  store: VehicleStore,
  kindCode: number,
  lineCode: number,
): boolean {
  if (quoteUpgradeLm(tuning, pool, kindCode, lineCode, 0) < 0 || pool.copies[kindCode]! <= 0) return false;
  pool.levels[kindCode * tuning.lines.length + lineCode]!++;
  for (const v of store.vehicles) {
    if (v.active && v.kindCode === kindCode) {
      const hadLamps = v.stats.lampRangeM > 0;
      v.levels[lineCode] = pool.levelOf(kindCode, lineCode);
      v.intakeCap = 255; // a new level selects itself
      refreshVehicleStats(tuning, v);
      if (!hadLamps && v.stats.lampRangeM > 0) v.lights = true; // first Running Lamps: switch them on
    }
  }
  return true;
}

// ---- Spawn / return ----

/**
 * Brings a vehicle out of the Motor Pool at unit direction (dx, dy, dz) heading along (hx, hy, hz). Returns the store
 * index, or a negative MP_* code.
 */
export function motorPoolSpawn(
  pool: MotorPoolState,
  store: VehicleStore,
  tuning: VehicleTuning,
  cfg: SimConfig,
  ground: SimGround,
  kindCode: number,
  ownerSlot: number,
  dx: number,
  dy: number,
  dz: number,
  hx: number,
  hy: number,
  hz: number,
): number {
  if (pool.poolsBuilt <= 0) return MP_NO_MOTOR_POOL;
  if (pool.copies[kindCode]! <= 0) return MP_NOT_OWNED;
  if (store.activeCount() >= pool.maxOut(tuning)) return MP_LIMIT_OUT;
  if (store.indexOfOwner(ownerSlot, kindCode) >= 0) return MP_ALREADY_OUT;
  let free = -1;
  for (let k = 0; k < store.vehicles.length; k++) {
    if (!store.vehicles[k]!.active) {
      free = k;
      break;
    }
  }
  if (free < 0) return MP_NO_FREE_SLOT;
  const v = store.vehicles[free]!;
  for (let l = 0; l < tuning.lines.length; l++) v.levels[l] = pool.levelOf(kindCode, l);
  spawnVehicle(v, tuning, cfg, ground, kindCode, ownerSlot, dx, dy, dz, hx, hy, hz);
  return free;
}

/**
 * Returns a vehicle to the Motor Pool. Its hopper is unloaded into the pool's included Dump Plate (`sink`) first; if the
 * sink cannot take it all the vehicle stays out (dust is never destroyed). True when it went home.
 */
export function motorPoolReturn(store: VehicleStore, index: number, sink: HopperSink): boolean {
  const v = store.vehicles[index];
  if (!v || !v.active) return false;
  dumpHopper(v, sink);
  if (v.hopperGrams > 0) return false;
  v.active = false;
  v.driverSlot = -1;
  v.speed = v.latSpeed = v.vr = 0;
  return true;
}

// ---- Driving seat ----

/**
 * An avatar takes the handle of a vehicle: it must own it, be within the handle reach, and nobody else may be driving.
 * (`ax, ay, az` = avatar position, moon-centred metres.)
 */
export function enterVehicle(
  v: VehicleState,
  tuning: VehicleTuning,
  slot: number,
  ax: number,
  ay: number,
  az: number,
  shared = false,
): boolean {
  if (!v.active || v.driverSlot >= 0 || (v.ownerSlot !== slot && !shared)) return false;
  const reach = tuning.kinds[v.kindCode]!.handling!.def.enterReachM;
  const back = tuning.kinds[v.kindCode]!.handling!.def.handleBackM;
  const hx = v.px - v.fx * back;
  const hy = v.py - v.fy * back;
  const hz = v.pz - v.fz * back;
  const dx = ax - hx;
  const dy = ay - hy;
  const dz = az - hz;
  if (dx * dx + dy * dy + dz * dz > reach * reach) return false;
  v.driverSlot = slot;
  return true;
}

/** The driver lets go; the vehicle coasts to a stop. False when `slot` is not the driver. */
export function exitVehicle(v: VehicleState, slot: number): boolean {
  if (!v.active || v.driverSlot !== slot) return false;
  v.driverSlot = -1;
  v.gear = 0;
  return true;
}

/** Writes the driver's standing point (handle, on the chassis ground point radius) into `out[0..2]`. */
export function vehicleHandlePoint(v: VehicleState, tuning: VehicleTuning, out: Float64Array): void {
  const back = tuning.kinds[v.kindCode]!.handling!.def.handleBackM;
  out[0] = v.px - v.fx * back;
  out[1] = v.py - v.fy * back;
  out[2] = v.pz - v.fz * back;
}
