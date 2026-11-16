// The vehicles of one room: Motor Pool purchases, calling / returning / entering / leaving a Trundle, driving it from the
// input command, vehicle strokes into the ledger, unloading the hopper at a Dump Plate (a plate against a Receiving Gate
// pays the Gate directly), snapshot / ShiftState records and the META keys of the checkpoint.
//
// Wire: no new intent kinds. Purchases ride the existing `purchase` intent (`piece.motor_pool`, `vehicle.trundle`,
// `vehicle_upgrade.<line>`); driving uses the input command (driver column of INPUT_BUTTON_MEANING: moveY throttle, moveX
// steer, jump handbrake, boost, laneLock Throttle Lock, lampCycle Running Lamps, interact exit). On foot, `interact` (edge)
// within reach of your Trundle's handle sits you down, and `seatSwitch` (edge; unused on foot so far) near the Motor Pool
// calls your Trundle out or sends it home. A contracts bump should name that meaning of `seatSwitch` on foot.
//
// The class is allocation-free per tick (typed stores, pooled intents); events and snapshots allocate like the room's own.

import type {
  ActorSlot,
  EntityId,
  PlayerId,
  SimEventMap,
  SimEventName,
  Tick,
  VehicleComponent,
  VehicleInfo,
} from "@moon-cleanup/shared";
import { INPUT_AXIS_MAX, INPUT_BUTTON_MASK as M, MAX_PLAYERS_PER_ROOM } from "@moon-cleanup/shared";
import type { GameData } from "@moon-cleanup/game-data";
import type { SimConfig } from "../config/sim-config";
import { Fnv1a32, quantize } from "../math/quantize";
import type { SimGround } from "../movement/avatar";
import type { MutableStroke } from "../tools/tool";
import type { DustLedgerPort } from "../dust/ledger-port";
import { DUMP_PLATE_RADIUS_M } from "../economy/selling";
import { hopperFill01, hopperLevel4, stepVehicleIntake, VehicleIntakeOut } from "./intake";
import {
  buildMotorPool,
  buyUpgrade,
  buyVehicle,
  enterVehicle,
  exitVehicle,
  MotorPoolState,
  motorPoolReturn,
  motorPoolSpawn,
  quoteUpgradeLm,
  quoteVehicleLm,
  vehicleHandlePoint,
  VehicleStore,
} from "./motor-pool";
import { resolveVehicleTuning, vehicleKindOf, type VehicleTuning } from "./tuning";
import {
  GEAR_LOCKED,
  hashVehicle,
  stepVehicle,
  VEHICLE_AIRBORNE,
  VEHICLE_GROUNDED,
  VehicleIntent,
  vehicleBasis,
  type VehicleState,
} from "./vehicle";
import type { PlotGrid } from "@moon-cleanup/shared";

/** Entity ids of vehicles: base + store index (far above cargo ids, below the outpost services). */
export const VEHICLE_ENTITY_ID_BASE = 0x7ffe0000;
/** Vehicles that can be out at once (store size; Motor Pools x vehiclesOutPerMotorPool is the real limit). */
export const MAX_VEHICLES_OUT = MAX_PLAYERS_PER_ROOM;
/** Motor Pools the shift may own. */
export const MAX_MOTOR_POOLS = 4;
/** Copies of one vehicle kind the shift may own. */
export const MAX_VEHICLE_COPIES = 8;
/** An avatar within this distance of a Motor Pool can call a vehicle out or send it home, metres. */
export const MOTOR_POOL_REACH_M = 20; // slots spawn spread +-15 m around the stand-in pool until the outpost layout exists
/** A vehicle spawns this far ahead of the avatar, metres. */
export const VEHICLE_SPAWN_AHEAD_M = 2.5;
/** A vehicle unloads at a Dump Plate within this reach of a Receiving Gate (the plate radius plus the chassis), metres. */
export const VEHICLE_DUMP_REACH_M = DUMP_PLATE_RADIUS_M + 1;
/** Unloading needs the vehicle stopped (the intake works above the same speed, so no dust arrives while it tips), m/s. */
export const VEHICLE_DUMP_MAX_SPEED_MPS = 0.05;

/** Item ids of the Motor Pool (purchase intent). */
export const MOTOR_POOL_ITEM_ID = "piece.motor_pool";

/** META key prefixes (all keys <= 64 printable ASCII, level byte 0..255). */
export const VEH_KEY_POOLS = "veh.pools";
const VEH_KEY_COPIES = "veh.cp.";
const VEH_KEY_LEVEL = "veh.lv.";
const VEH_KEY_HOPPER = "veh.h"; // veh.h0.<slot>, veh.h1.<slot>, veh.h2.<slot>: little-endian bytes of the hopper grams

export type VehicleReject = "unknown_item" | "prereq_missing" | "max_level" | "cap_reached";

/** What a purchase item id means to the vehicles. */
export class VehicleItem {
  /** 0 = Motor Pool, 1 = vehicle, 2 = upgrade line. */
  type = 0;
  kind = -1;
  line = -1;
}

/** What the room gives the vehicles (bound closures: private room methods stay private). */
export interface VehicleHost {
  readonly config: SimConfig;
  readonly ground: SimGround;
  readonly grid: PlotGrid;
  readonly ledger: DustLedgerPort;
  emit<K extends SimEventName>(name: K, payload: SimEventMap[K]): void;
  /** True when (x, y, z) is within `reachM` of a Receiving Gate. */
  gateNear(x: number, y: number, z: number, reachM: number): boolean;
  /** Credits a dust sale at the Gate (wallet, Railshot, `cargo.sold`). */
  sellAtGate(owner: number, grams: number, tick: number): void;
  /** A vehicle stroke was applied to the ledger: pay the plot events and hand the stroke to the host pool. */
  strokeApplied(stroke: MutableStroke, tick: number): void;
}

export interface RoomVehiclesOptions {
  /** Vehicle ids sold (default: MVP_SCOPE.vehicleIds). Only kinds with a handling table can be driven. */
  readonly offeredKindIds: readonly string[];
  /** Upgrade lines sold (the card names Gear Ratio and Cargo Expander for the MVP). */
  readonly offeredLineIds: readonly string[];
  /** Motor Pools the shift starts with (the MVP slice has one pre-built). */
  readonly motorPoolsBuilt: number;
  /** Motor Pool positions (unit directions); a pool beyond the list sits at the last point. */
  readonly motorPoolPoints: readonly { readonly x: number; readonly y: number; readonly z: number }[];
}

const tmp = new Float64Array(3);

export class RoomVehicles {
  readonly tuning: VehicleTuning;
  readonly pool: MotorPoolState;
  readonly store: VehicleStore;
  /** Per actor: store index of the vehicle being driven, or -1. */
  readonly driving = new Int8Array(MAX_PLAYERS_PER_ROOM).fill(-1);
  /** Grams of dust an owner's vehicle held when it left the world (checkpoint restore, owner left); next spawn gets it. */
  readonly hopperCarry = new Int32Array(MAX_PLAYERS_PER_ROOM);
  private readonly defaultPools: number;
  private readonly offeredKind: Uint8Array;
  private readonly offeredLine: Uint8Array;
  private readonly poolX: Float64Array;
  private readonly poolY: Float64Array;
  private readonly poolZ: Float64Array;
  /** Driver intents by store index (filled in the driver's actor step, consumed by `step`). */
  private readonly intents: VehicleIntent[] = [];
  private readonly intakeOut = new VehicleIntakeOut();
  private readonly itemOut = new VehicleItem();
  /** Counters (rejected, never thrown). */
  readonly counters = { intakeHopperFull: 0, spawnsRefused: 0, returnsRefused: 0, entersRefused: 0 };

  constructor(
    data: GameData,
    private readonly cfg: SimConfig,
    options: RoomVehiclesOptions,
  ) {
    this.tuning = resolveVehicleTuning(data, cfg);
    this.pool = new MotorPoolState(this.tuning);
    this.pool.poolsBuilt = Math.max(0, Math.min(MAX_MOTOR_POOLS, Math.floor(options.motorPoolsBuilt)));
    this.defaultPools = this.pool.poolsBuilt;
    this.store = new VehicleStore(MAX_VEHICLES_OUT, this.tuning.lines.length);
    for (let k = 0; k < MAX_VEHICLES_OUT; k++) this.intents.push(new VehicleIntent());
    this.offeredKind = new Uint8Array(this.tuning.kinds.length);
    for (const id of options.offeredKindIds) {
      const k = vehicleKindOf(this.tuning, id);
      if (k >= 0 && this.tuning.kinds[k]!.handling) this.offeredKind[k] = 1;
    }
    this.offeredLine = new Uint8Array(this.tuning.lines.length);
    for (const id of options.offeredLineIds) {
      const l = this.tuning.lines.findIndex((x) => x.id === id);
      if (l >= 0) this.offeredLine[l] = 1;
    }
    const pts = options.motorPoolPoints.length > 0 ? options.motorPoolPoints : [{ x: 0, y: 1, z: 0 }];
    this.poolX = new Float64Array(MAX_MOTOR_POOLS);
    this.poolY = new Float64Array(MAX_MOTOR_POOLS);
    this.poolZ = new Float64Array(MAX_MOTOR_POOLS);
    for (let p = 0; p < MAX_MOTOR_POOLS; p++) {
      const pt = pts[Math.min(p, pts.length - 1)]!;
      const l = Math.sqrt(pt.x * pt.x + pt.y * pt.y + pt.z * pt.z) || 1;
      this.poolX[p] = pt.x / l;
      this.poolY[p] = pt.y / l;
      this.poolZ[p] = pt.z / l;
    }
  }

  // ---- Purchases ----

  /** What `itemId` means to the vehicles (Motor Pool, vehicle, upgrade line), or null. The result is reused. */
  classify(itemId: string): VehicleItem | null {
    const o = this.itemOut;
    if (itemId === MOTOR_POOL_ITEM_ID) {
      o.type = 0;
      o.kind = o.line = -1;
      return o;
    }
    if (itemId.startsWith("vehicle_upgrade.")) {
      const l = this.tuning.lines.findIndex((x) => x.id === itemId);
      if (l < 0) return null;
      o.type = 2;
      o.line = l;
      o.kind = this.upgradeKind(l);
      return o;
    }
    if (itemId.startsWith("vehicle.")) {
      const k = vehicleKindOf(this.tuning, itemId);
      if (k < 0) return null;
      o.type = 1;
      o.kind = k;
      o.line = -1;
      return o;
    }
    return null;
  }

  /** The vehicle an upgrade line is bought for: the first offered kind that offers the line, owned, else the first offered. */
  private upgradeKind(line: number): number {
    let first = -1;
    for (const k of this.tuning.kinds) {
      if (!this.offeredKind[k.code] || !k.lineCodes.includes(line)) continue;
      if (first < 0) first = k.code;
      if (this.pool.copies[k.code]! > 0) return k.code;
    }
    return first;
  }

  /**
   * Price of a vehicle item for the next purchase, whole Lumens after the Rebate, or a negative VehicleReject code
   * index (-1 unknown_item, -2 prereq_missing, -3 max_level, -4 cap_reached).
   */
  quote(item: VehicleItem, rebateFrac: number): number {
    const t = this.tuning;
    if (item.type === 0) {
      if (this.pool.poolsBuilt >= MAX_MOTOR_POOLS) return -4;
      return t.motorPool.priceLm; // the Rebate covers tools, Cells and vehicles; the Motor Pool pays list
    }
    if (item.kind < 0 || !this.offeredKind[item.kind]) return -1;
    if (item.type === 1) {
      if (this.pool.poolsBuilt <= 0) return -2;
      if (this.pool.copies[item.kind]! >= MAX_VEHICLE_COPIES) return -4;
      return quoteVehicleLm(t, this.pool, item.kind, rebateFrac);
    }
    if (!this.offeredLine[item.line]) return -1;
    if (this.pool.copies[item.kind]! <= 0) return -2;
    const p = quoteUpgradeLm(t, this.pool, item.kind, item.line, rebateFrac);
    return p < 0 ? -3 : p;
  }

  /** Applies a paid purchase; returns the level now owned (pools built, copies, or line level). */
  apply(item: VehicleItem): number {
    if (item.type === 0) {
      buildMotorPool(this.pool);
      return this.pool.poolsBuilt;
    }
    if (item.type === 1) {
      buyVehicle(this.pool, item.kind);
      return this.pool.copies[item.kind]!;
    }
    buyUpgrade(this.tuning, this.pool, this.store, item.kind, item.line);
    return this.pool.levelOf(item.kind, item.line);
  }

  /** True when the build sells (and can drive) vehicle kind `code`. */
  isOffered(code: number): boolean {
    return this.offeredKind[code] === 1;
  }

  // ---- Calling, returning, entering, leaving ----

  /** Index of the nearest Motor Pool within reach of (x, y, z), or -1. Unit-direction distance scaled to metres. */
  private poolNear(x: number, y: number, z: number): number {
    const l = Math.sqrt(x * x + y * y + z * z);
    if (l === 0) return -1;
    const r = MOTOR_POOL_REACH_M / this.cfg.moonRadiusM;
    for (let p = 0; p < this.pool.poolsBuilt; p++) {
      const dx = x / l - this.poolX[p]!;
      const dy = y / l - this.poolY[p]!;
      const dz = z / l - this.poolZ[p]!;
      if (dx * dx + dy * dy + dz * dz <= r * r) return p;
    }
    return -1;
  }

  /** The kind an owner calls: the first offered kind they could use (the Trundle in the MVP) that the shift bought. */
  private callKind(): number {
    for (const k of this.tuning.kinds) if (this.offeredKind[k.code] && this.pool.copies[k.code]! > 0) return k.code;
    return -1;
  }

  /**
   * `seatSwitch` on foot. With no vehicle of yours out and a Motor Pool within reach, calls your vehicle out ahead of
   * you; with one out and both you and it within reach of a Motor Pool, sends it home (the hopper unloads into the
   * pool's included Dump Plate: it must be against a Receiving Gate, else the vehicle stays out). Returns true on a
   * state change.
   */
  callOrReturn(
    slot: number,
    ax: number,
    ay: number,
    az: number,
    fx: number,
    fy: number,
    fz: number,
    tick: number,
    host: VehicleHost,
  ): boolean {
    if (this.poolNear(ax, ay, az) < 0) {
      this.counters.spawnsRefused++;
      return false;
    }
    const kind = this.callKind();
    if (kind < 0) {
      this.counters.spawnsRefused++;
      return false;
    }
    const out = this.store.indexOfOwner(slot, kind);
    if (out >= 0) {
      const v = this.store.vehicles[out]!;
      if (this.poolNear(v.px, v.py, v.pz) < 0 || v.driverSlot >= 0) {
        this.counters.returnsRefused++;
        return false;
      }
      const nearGate = host.gateNear(v.px, v.py, v.pz, VEHICLE_DUMP_REACH_M);
      const sink = { accept: (g: number): number => (nearGate ? g : 0) };
      const before = v.hopperGrams;
      if (!motorPoolReturn(this.store, out, sink)) {
        this.counters.returnsRefused++;
        return false;
      }
      if (before > 0) host.sellAtGate(slot, before, tick);
      return true;
    }
    // Spawn ahead of the avatar along its facing.
    const px = ax + fx * VEHICLE_SPAWN_AHEAD_M;
    const py = ay + fy * VEHICLE_SPAWN_AHEAD_M;
    const pz = az + fz * VEHICLE_SPAWN_AHEAD_M;
    const idx = motorPoolSpawn(
      this.pool,
      this.store,
      this.tuning,
      host.config,
      host.ground,
      kind,
      slot,
      px,
      py,
      pz,
      fx,
      fy,
      fz,
    );
    if (idx < 0) {
      this.counters.spawnsRefused++;
      return false;
    }
    const v = this.store.vehicles[idx]!;
    // Dust an earlier vehicle of this owner left behind rides along (conserved mass).
    const carry = this.hopperCarry[slot]!;
    if (carry > 0) {
      const take = Math.min(carry, v.stats.payloadGrams);
      v.hopperGrams = take;
      this.hopperCarry[slot] = carry - take;
    }
    return true;
  }

  /** `interact` on foot: sit down at the handle of a vehicle within reach (own, or shared with the driver permission). */
  tryEnter(
    slot: number,
    ax: number,
    ay: number,
    az: number,
    shared: boolean,
    tick: number,
    host: VehicleHost,
  ): boolean {
    for (let i = 0; i < this.store.vehicles.length; i++) {
      const v = this.store.vehicles[i]!;
      if (!v.active || v.driverSlot >= 0) continue;
      if (!enterVehicle(v, this.tuning, slot, ax, ay, az, shared)) continue;
      this.driving[slot] = i;
      host.emit("vehicle.entered", {
        tick: tick as Tick,
        actorSlot: slot,
        vehicleId: (VEHICLE_ENTITY_ID_BASE + i) as EntityId,
        kindId: this.tuning.kinds[v.kindCode]!.id,
        seat: 0,
      });
      return true;
    }
    this.counters.entersRefused++;
    return false;
  }

  /** The driver lets go (exit button, leaving the room). */
  leave(slot: number, tick: number, host: VehicleHost): void {
    const i = this.driving[slot]!;
    if (i < 0) return;
    this.driving[slot] = -1;
    const v = this.store.vehicles[i]!;
    if (!exitVehicle(v, slot)) return;
    host.emit("vehicle.exited", {
      tick: tick as Tick,
      actorSlot: slot,
      vehicleId: (VEHICLE_ENTITY_ID_BASE + i) as EntityId,
      kindId: this.tuning.kinds[v.kindCode]!.id,
    });
  }

  /** An actor left the room: it lets go, and its vehicles go home (dust that cannot be sold is kept for the slot). */
  removeActor(slot: number, tick: number, host: VehicleHost): void {
    this.leave(slot, tick, host);
    for (let i = 0; i < this.store.vehicles.length; i++) {
      const v = this.store.vehicles[i]!;
      if (!v.active || v.ownerSlot !== slot) continue;
      if (v.driverSlot >= 0) this.leave(v.driverSlot, tick, host);
      this.hopperCarry[slot] = this.hopperCarry[slot]! + v.hopperGrams;
      v.hopperGrams = 0;
      v.active = false;
    }
  }

  // ---- Per tick ----

  /** Fills the driver's intent for the vehicle it drives (store index `i`) from its input command. */
  driverIntent(i: number, moveX: number, moveY: number, buttons: number, prevButtons: number): void {
    const out = this.intents[i]!;
    const pressed = buttons & ~prevButtons;
    const ty = moveY / INPUT_AXIS_MAX;
    const sx = moveX / INPUT_AXIS_MAX;
    out.throttle = ty > 1 ? 1 : ty < -1 ? -1 : ty;
    out.steer = sx > 1 ? 1 : sx < -1 ? -1 : sx;
    out.boost = (buttons & M.boost) !== 0;
    out.handbrake = (buttons & M.jump) !== 0;
    out.lockPressed = (pressed & M.laneLock) !== 0;
    out.lightsPressed = (pressed & M.lampCycle) !== 0;
    out.cycleIntakePressed = (pressed & M.holsterNext) !== 0;
  }

  /** Steps every vehicle (ascending store index), its intake, and the Dump Plate unload. */
  step(tick: number, night: boolean, host: VehicleHost, onDriverMoved: (slot: number, v: VehicleState) => void): void {
    const vs = this.store.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i]!;
      if (!v.active) continue;
      stepVehicle(v, this.intents[i]!, this.tuning, this.cfg, host.ground);
      // Clear the intent edges and axes of the next tick when nobody refreshes them (driver gone).
      if (v.driverSlot < 0) {
        const it = this.intents[i]!;
        it.throttle = it.steer = 0;
        it.boost = it.handbrake = it.lockPressed = it.lightsPressed = it.cycleIntakePressed = false;
      }
      const out = this.intakeOut;
      if (stepVehicleIntake(v, this.tuning, this.cfg, host.grid, host.ground, host.ledger, tick, i, night, out)) {
        host.strokeApplied(out.stroke, tick);
      }
      if (out.rejectedFull > 0) {
        this.counters.intakeHopperFull += out.rejectedFull;
        out.rejectedFull = 0;
      }
      // Dump Plate: slow, grounded, loaded, at a plate against a Gate.
      if (
        v.hopperGrams > 0 &&
        v.moveState === VEHICLE_GROUNDED &&
        v.speed < VEHICLE_DUMP_MAX_SPEED_MPS &&
        v.speed > -VEHICLE_DUMP_MAX_SPEED_MPS &&
        host.gateNear(v.px, v.py, v.pz, VEHICLE_DUMP_REACH_M)
      ) {
        const grams = v.hopperGrams;
        v.hopperGrams = 0;
        host.sellAtGate(v.ownerSlot, grams, tick);
      }
      if (v.driverSlot >= 0) onDriverMoved(v.driverSlot, v);
    }
  }

  /** The driver's standing point (the handle) into `out[0..2]`, on the ground. */
  handlePoint(v: VehicleState, ground: SimGround, out: Float64Array): void {
    vehicleHandlePoint(v, this.tuning, tmp);
    const l = Math.sqrt(tmp[0]! * tmp[0]! + tmp[1]! * tmp[1]! + tmp[2]! * tmp[2]!);
    const ux = tmp[0]! / l;
    const uy = tmp[1]! / l;
    const uz = tmp[2]! / l;
    const rg = this.cfg.moonRadiusM + ground.heightAtXYZ(ux, uy, uz);
    out[0] = quantize(ux * rg);
    out[1] = quantize(uy * rg);
    out[2] = quantize(uz * rg);
  }

  // ---- State hash, snapshot, checkpoint ----

  /** True when anything differs from a fresh shift (hash and checkpoint skip the vehicles otherwise). */
  get dirty(): boolean {
    if (this.pool.poolsBuilt !== this.defaultPools) return true;
    for (let k = 0; k < this.pool.copies.length; k++) if (this.pool.copies[k]! > 0) return true;
    for (let k = 0; k < this.hopperCarry.length; k++) if (this.hopperCarry[k]! > 0) return true;
    return false;
  }

  hash(h: Fnv1a32): void {
    h.int(0x60000 | this.pool.poolsBuilt);
    for (let k = 0; k < this.pool.copies.length; k++)
      if (this.pool.copies[k]! > 0) h.int(0x61000 | (k << 8) | this.pool.copies[k]!);
    for (let k = 0; k < this.pool.levels.length; k++)
      if (this.pool.levels[k]! > 0) h.int(0x62000 | (k << 8) | this.pool.levels[k]!);
    for (let s = 0; s < this.hopperCarry.length; s++) {
      if (this.hopperCarry[s]! <= 0) continue;
      h.int(0x63000 | s);
      h.int(this.hopperCarry[s]!);
    }
    const vs = this.store.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i]!;
      if (!v.active) continue;
      h.int(0x64000 | i);
      h.int(v.ownerSlot);
      hashVehicle(v, h);
    }
  }

  /** Snapshot records of the vehicles out. */
  components(out: VehicleComponent[], entityIds: EntityId[]): void {
    const vs = this.store.vehicles;
    const b = new Float64Array(9);
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i]!;
      if (!v.active) continue;
      vehicleBasis(v, b);
      const id = (VEHICLE_ENTITY_ID_BASE + i) as EntityId;
      entityIds.push(id);
      const kind = this.tuning.kinds[v.kindCode]!;
      // Body axes: x = right, y = up, z = backward (three.js convention: forward is -z).
      const q = quatFromAxes(b[6]!, b[7]!, b[8]!, b[0]!, b[1]!, b[2]!, -b[3]!, -b[4]!, -b[5]!);
      out.push({
        entityId: id,
        kindId: kind.id,
        ownerSlot: v.ownerSlot as ActorSlot,
        driverSlot: v.driverSlot >= 0 ? (v.driverSlot as ActorSlot) : null,
        transform: { position: { x: v.px, y: v.py, z: v.pz }, orientation: q },
        linearVelocity: {
          x: b[3]! * v.speed + b[6]! * v.latSpeed + b[0]! * v.vr,
          y: b[4]! * v.speed + b[7]! * v.latSpeed + b[1]! * v.vr,
          z: b[5]! * v.speed + b[8]! * v.latSpeed + b[2]! * v.vr,
        },
        angularVelocity: { x: 0, y: 0, z: 0 },
        steer: v.steer,
        speed: v.speed as never,
        gear: (["neutral", "drive", "reverse", "locked"] as const)[v.gear] ?? "neutral",
        boosting: v.boosting,
        lights: v.lights,
        intake: v.intakeDown,
        hopperLevel: hopperLevel4(v),
      });
    }
  }

  /** ShiftState vehicle records (owner id looked up by the caller). */
  shiftRecords(ownerOf: (slot: number) => PlayerId, out: VehicleInfo[]): void {
    const vs = this.store.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i]!;
      if (!v.active) continue;
      const upgrades: Record<string, number> = {};
      for (let l = 0; l < this.tuning.lines.length; l++) {
        if (v.levels[l]! > 0) upgrades[this.tuning.lines[l]!.id] = v.levels[l]!;
      }
      out.push({
        entityId: VEHICLE_ENTITY_ID_BASE + i,
        type: this.tuning.kinds[v.kindCode]!.id,
        ownerPlayerId: ownerOf(v.ownerSlot),
        upgrades,
        occupied: v.driverSlot >= 0,
      });
    }
  }

  /** Vehicle kinds the shift owns (for `PlayerInfo.vehicleIds`). */
  ownedKindIds(): string[] {
    const ids: string[] = [];
    for (const k of this.tuning.kinds) if (this.pool.copies[k.code]! > 0) ids.push(k.id);
    return ids;
  }

  /** Per-actor read-out of the vehicle being driven (HUD), false when on foot. */
  readout(slot: number, out: VehicleReadout): boolean {
    const i = this.driving[slot]!;
    if (i < 0) return false;
    const v = this.store.vehicles[i]!;
    const hnd = this.tuning.kinds[v.kindCode]!.handling!;
    out.kindId = this.tuning.kinds[v.kindCode]!.id;
    out.speed01 = Math.min(1, Math.abs(v.speed) / (v.stats.cruiseMps * v.stats.speedMult));
    out.hopper01 = hopperFill01(v);
    out.boost01 = hnd.boostMeterMs > 0 ? v.boostMeterMs / hnd.boostMeterMs : 0;
    out.boosting = v.boosting;
    out.locked = v.gear === GEAR_LOCKED;
    out.airborne = v.moveState === VEHICLE_AIRBORNE;
    out.intakeDown = v.intakeDown;
    return true;
  }

  // ---- Checkpoint META keys ----

  /** Max level of every key this module writes (registered so validateCheckpointMeta accepts them). */
  registerKeys(max: Map<string, number>): void {
    max.set(VEH_KEY_POOLS, MAX_MOTOR_POOLS);
    for (const k of this.tuning.kinds) {
      max.set(`${VEH_KEY_COPIES}${k.code}`, MAX_VEHICLE_COPIES);
      for (const lc of k.lineCodes) max.set(`${VEH_KEY_LEVEL}${k.code}.${lc}`, this.tuning.lines[lc]!.costMult.length);
    }
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++)
      for (let d = 0; d < 3; d++) max.set(`${VEH_KEY_HOPPER}${d}.${s}`, 255);
  }

  /**
   * META keys of the current state (only what differs from a fresh shift). Vehicles out are saved as their owner's
   * carried hopper dust: on restore they are back in the Motor Pool and the owner's next call brings the dust along.
   */
  captureKeys(): Record<string, number> {
    const out: Record<string, number> = {};
    if (this.pool.poolsBuilt !== this.defaultPools) out[VEH_KEY_POOLS] = this.pool.poolsBuilt;
    for (const k of this.tuning.kinds) {
      const c = this.pool.copies[k.code]!;
      if (c > 0) out[`${VEH_KEY_COPIES}${k.code}`] = c;
      for (const lc of k.lineCodes) {
        const lv = this.pool.levelOf(k.code, lc);
        if (lv > 0) out[`${VEH_KEY_LEVEL}${k.code}.${lc}`] = lv;
      }
    }
    const carry = new Int32Array(MAX_PLAYERS_PER_ROOM);
    carry.set(this.hopperCarry);
    for (const v of this.store.vehicles) if (v.active) carry[v.ownerSlot] = carry[v.ownerSlot]! + v.hopperGrams;
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      const g = carry[s]!;
      if (g <= 0) continue;
      for (let d = 0; d < 3; d++) out[`${VEH_KEY_HOPPER}${d}.${s}`] = (g >>> (8 * d)) & 0xff;
    }
    return out;
  }

  /** Restores from validated META keys (consumed ones are deleted from `gear`). Vehicles out go home. */
  restoreKeys(gear: Record<string, number>): void {
    this.pool.poolsBuilt = gear[VEH_KEY_POOLS] ?? this.defaultPools;
    delete gear[VEH_KEY_POOLS];
    this.pool.copies.fill(0);
    this.pool.levels.fill(0);
    for (const k of this.tuning.kinds) {
      const ck = `${VEH_KEY_COPIES}${k.code}`;
      this.pool.copies[k.code] = gear[ck] ?? 0;
      delete gear[ck];
      for (const lc of k.lineCodes) {
        const lk = `${VEH_KEY_LEVEL}${k.code}.${lc}`;
        this.pool.levels[k.code * this.tuning.lines.length + lc] = gear[lk] ?? 0;
        delete gear[lk];
      }
    }
    for (const v of this.store.vehicles) {
      v.active = false;
      v.driverSlot = -1;
    }
    this.driving.fill(-1);
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      let g = 0;
      for (let d = 0; d < 3; d++) {
        const key = `${VEH_KEY_HOPPER}${d}.${s}`;
        g |= (gear[key] ?? 0) << (8 * d);
        delete gear[key];
      }
      this.hopperCarry[s] = g;
    }
  }
}

/** HUD read-out of the driven vehicle (reused by the caller). */
export class VehicleReadout {
  kindId = "";
  speed01 = 0;
  hopper01 = 0;
  boost01 = 0;
  boosting = false;
  locked = false;
  airborne = false;
  intakeDown = false;
}

/** Unit quaternion of the rotation whose columns are the body axes x, y, z (rotation matrix to quaternion). */
function quatFromAxes(
  xx: number,
  xy: number,
  xz: number,
  yx: number,
  yy: number,
  yz: number,
  zx: number,
  zy: number,
  zz: number,
): { x: number; y: number; z: number; w: number } {
  // Matrix rows: m00 = xx, m01 = yx, m02 = zx; m10 = xy, m11 = yy, m12 = zy; m20 = xz, m21 = yz, m22 = zz.
  const tr = xx + yy + zz;
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s;
    x = (yz - zy) / s;
    y = (zx - xz) / s;
    z = (xy - yx) / s;
  } else if (xx > yy && xx > zz) {
    const s = Math.sqrt(1 + xx - yy - zz) * 2;
    w = (yz - zy) / s;
    x = 0.25 * s;
    y = (yx + xy) / s;
    z = (zx + xz) / s;
  } else if (yy > zz) {
    const s = Math.sqrt(1 + yy - xx - zz) * 2;
    w = (zx - xz) / s;
    x = (yx + xy) / s;
    y = 0.25 * s;
    z = (zy + yz) / s;
  } else {
    const s = Math.sqrt(1 + zz - xx - yy) * 2;
    w = (xy - yx) / s;
    x = (zx + xz) / s;
    y = (zy + yz) / s;
    z = 0.25 * s;
  }
  const n = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
  return { x: x / n, y: y / n, z: z / n, w: w / n };
}
