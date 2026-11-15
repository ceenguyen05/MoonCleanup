// Dust Pucks and Puck Stacks (progression-and-economy section 5; game-feel-and-controls section 3.6; scope-tiers
// section 1 row Dust Pucks).
//
// F tap forms one Dust Puck (puckKg, or what is left in the Cell) at the feet; F held for formHoldTicks bands the
// whole Cell into Puck Stacks of at most stackMaxKg. Q tap picks up the nearest loose puck or stack within the pickup
// radius, or drops the newest carried one; Q held and released throws it (speed rises with the hold, fixed launch
// pitch above the camera heading, true lunar parabola, skid on landing, no bounce). E while carrying pours the carried
// puck back into the equipped Cell (up to capacity). Loose units (lying, flying or skidding) obey the caps: per player
// and per contract; forming beyond your cap merges into your newest loose unit, a drop or throw beyond it is refused.
// Resting units that touch merge (<= stackMaxKg). A loose unit untouched for despawnTicks is auto-collected at
// despawnValueFrac of its mass (credited grams wait in `pendingGateGrams` for the economy's Gate ledger).
//
// Storage is a fixed structure-of-arrays pool (no allocation per tick); entity ids are handed out in order.

import { MAX_PLAYERS_PER_ROOM } from "@moon-cleanup/shared";
import type { SimConfig } from "../config/sim-config";
import { cosTurn, sinTurn } from "../math/trig";
import type { AvatarState, SimGround } from "../movement/avatar";
import { headingBasis } from "../movement/avatar";
import { actorCellCap, relatchCell, type ToolState } from "../tools/tool";

export const CARGO_FREE = 0;
export const CARGO_RESTING = 1;
export const CARGO_FLYING = 2;
export const CARGO_SKIDDING = 3;
export const CARGO_CARRIED = 4;

/** First cargo entity id (actor entities are 1 .. MAX_PLAYERS_PER_ROOM). */
export const CARGO_ENTITY_ID_BASE = 1024;
/** Most units one actor can hold (carryUnits plus Railhand headroom); sizes the pool. */
const CARRY_SLOTS_PER_ACTOR = 4;

/** What a cargo step did for one actor (the room turns these into events). Reused, never reallocated. */
export class CargoActorResult {
  formedId = 0;
  bandedFirstId = 0;
  bandedStacks = 0;
  bandedPucks = 0;
  pickedUpId = 0;
  thrownId = 0;
  clear(): void {
    this.formedId = this.bandedFirstId = this.bandedStacks = this.bandedPucks = this.pickedUpId = this.thrownId = 0;
  }
}

export class CargoStore {
  readonly capacity: number;
  readonly state: Uint8Array;
  readonly entityId: Int32Array;
  /** Last handler (former, dropper or thrower): whose loose cap the unit counts against. */
  readonly owner: Int8Array;
  readonly count: Uint16Array;
  readonly grams: Int32Array;
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly pz: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly vz: Float64Array;
  readonly carriedBy: Int8Array;
  readonly touchTick: Int32Array;
  /** Creation / last-loose order (newest = largest). */
  readonly order: Int32Array;
  nextId = CARGO_ENTITY_ID_BASE;
  nextOrder = 1;
  /** Loose units (resting, flying, skidding) in all / per owner. */
  loose = 0;
  readonly looseBy = new Int32Array(MAX_PLAYERS_PER_ROOM);
  /** Mass auto-collected at despawn (full) and the value-weighted grams owed to the Gate ledger (economy reads). */
  despawnedGrams = 0;
  pendingGateGrams = 0;
  /** Per actor: ticks F / Q have been held (-1 = not held), and whether the F hold already banded. */
  readonly formHeld = new Int32Array(MAX_PLAYERS_PER_ROOM).fill(-1);
  readonly formBanded = new Uint8Array(MAX_PLAYERS_PER_ROOM);
  readonly qHeld = new Int32Array(MAX_PLAYERS_PER_ROOM).fill(-1);
  readonly counters = {
    formRejectedCap: 0,
    formEmptyCell: 0,
    dropRejectedCap: 0,
    merged: 0,
    despawned: 0,
    pouredBackGrams: 0,
  };

  constructor(cfg: SimConfig) {
    const n = cfg.cargo.loosePerContract + MAX_PLAYERS_PER_ROOM * CARRY_SLOTS_PER_ACTOR;
    this.capacity = n;
    this.state = new Uint8Array(n);
    this.entityId = new Int32Array(n);
    this.owner = new Int8Array(n);
    this.count = new Uint16Array(n);
    this.grams = new Int32Array(n);
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.pz = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.vz = new Float64Array(n);
    this.carriedBy = new Int8Array(n).fill(-1);
    this.touchTick = new Int32Array(n);
    this.order = new Int32Array(n);
  }

  /** Units carried by `slot`. */
  carriedCount(slot: number): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) if (this.state[i] === CARGO_CARRIED && this.carriedBy[i] === slot) n++;
    return n;
  }

  /** Total grams in the pool (carried + loose): conservation checks. */
  totalGrams(): number {
    let g = 0;
    for (let i = 0; i < this.capacity; i++) if (this.state[i] !== CARGO_FREE) g += this.grams[i]!;
    return g;
  }
}

const foot = new Float64Array(3);
const basis = new Float64Array(9);

function isLoose(st: number): boolean {
  return st === CARGO_RESTING || st === CARGO_FLYING || st === CARGO_SKIDDING;
}

/** Ground point `forward` metres in front of the feet of `a` (along the body facing) into `foot`. */
function feetPoint(a: AvatarState, cfg: SimConfig, ground: SimGround, forward: number): void {
  const l = Math.sqrt(a.px * a.px + a.py * a.py + a.pz * a.pz);
  const k = (l - a.heightAboveGround) / l;
  const x = a.px * k + a.fx * forward;
  const y = a.py * k + a.fy * forward;
  const z = a.pz * k + a.fz * forward;
  const hl = Math.sqrt(x * x + y * y + z * z);
  const ux = x / hl;
  const uy = y / hl;
  const uz = z / hl;
  const r = cfg.moonRadiusM + ground.heightAtXYZ(ux, uy, uz);
  foot[0] = ux * r;
  foot[1] = uy * r;
  foot[2] = uz * r;
}

function freeSlot(c: CargoStore): number {
  for (let i = 0; i < c.capacity; i++) if (c.state[i] === CARGO_FREE) return i;
  return -1;
}

function release(c: CargoStore, i: number): void {
  if (isLoose(c.state[i]!)) {
    c.loose--;
    const o = c.owner[i]!;
    if (o >= 0) c.looseBy[o]!--;
  }
  c.state[i] = CARGO_FREE;
  c.carriedBy[i] = -1;
  c.grams[i] = 0;
  c.count[i] = 0;
}

/** Makes unit `i` loose (owner `slot`), keeping the loose counters right. */
function setLoose(c: CargoStore, i: number, slot: number, st: number, tick: number): void {
  if (!isLoose(c.state[i]!)) {
    c.loose++;
    c.looseBy[slot]!++;
  } else if (c.owner[i] !== slot) {
    const o = c.owner[i]!;
    if (o >= 0) c.looseBy[o]!--;
    c.looseBy[slot]!++;
  }
  c.owner[i] = slot;
  c.state[i] = st;
  c.carriedBy[i] = -1;
  c.touchTick[i] = tick;
  c.order[i] = c.nextOrder++;
}

function capFull(cfg: SimConfig, c: CargoStore, slot: number): boolean {
  return c.looseBy[slot]! >= cfg.cargo.loosePerPlayer || c.loose >= cfg.cargo.loosePerContract;
}

/** Newest loose unit of `slot` that can take `grams` more, or -1. */
function newestMergeTarget(cfg: SimConfig, c: CargoStore, slot: number, grams: number): number {
  let best = -1;
  for (let i = 0; i < c.capacity; i++) {
    if (!isLoose(c.state[i]!) || c.owner[i] !== slot) continue;
    if (c.grams[i]! + grams > cfg.cargo.stackMaxGrams) continue;
    if (best < 0 || c.order[i]! > c.order[best]!) best = i;
  }
  return best;
}

function pucksIn(cfg: SimConfig, grams: number): number {
  const p = cfg.cargo.puckGrams;
  return Math.max(1, Math.ceil(grams / p));
}

/**
 * Places `grams` of dust from the equipped Cell as a new loose unit at the feet (or merges it into the newest loose
 * unit beyond the cap). Returns the entity id that received it, or 0 when refused.
 */
function placeFromCell(
  cfg: SimConfig,
  c: CargoStore,
  a: AvatarState,
  ground: SimGround,
  slot: number,
  grams: number,
  tick: number,
): number {
  let i: number;
  if (capFull(cfg, c, slot)) {
    i = newestMergeTarget(cfg, c, slot, grams);
    if (i < 0) {
      c.counters.formRejectedCap++;
      return 0;
    }
    c.grams[i] = c.grams[i]! + grams;
    c.count[i] = pucksIn(cfg, c.grams[i]!);
    c.touchTick[i] = tick;
    c.counters.merged++;
    return c.entityId[i]!;
  }
  i = freeSlot(c);
  if (i < 0) {
    c.counters.formRejectedCap++;
    return 0;
  }
  feetPoint(a, cfg, ground, cfg.cargo.dropForwardM);
  c.entityId[i] = c.nextId++;
  c.grams[i] = grams;
  c.count[i] = pucksIn(cfg, grams);
  c.px[i] = foot[0]!;
  c.py[i] = foot[1]!;
  c.pz[i] = foot[2]!;
  c.vx[i] = c.vy[i] = c.vz[i] = 0;
  c.state[i] = CARGO_FREE; // setLoose counts it
  setLoose(c, i, slot, CARGO_RESTING, tick);
  return c.entityId[mergeResting(cfg, c, i)]!;
}

/** F tap: one puck (puckKg, or the rest of the Cell). */
export function formPuck(
  cfg: SimConfig,
  c: CargoStore,
  a: AvatarState,
  t: ToolState,
  ground: SimGround,
  slot: number,
  tick: number,
): number {
  const cell = t.cellGrams[t.toolCode] ?? 0;
  if (cell <= 0) {
    c.counters.formEmptyCell++;
    return 0;
  }
  const g = cell < cfg.cargo.puckGrams ? cell : cfg.cargo.puckGrams;
  const id = placeFromCell(cfg, c, a, ground, slot, g, tick);
  if (id !== 0) {
    t.cellGrams[t.toolCode] = cell - g;
    relatchCell(cfg, t);
  }
  return id;
}

/** F hold: the whole Cell as Puck Stacks of at most stackMaxKg. Writes the stack count / pucks into `out`. */
export function bandCell(
  cfg: SimConfig,
  c: CargoStore,
  a: AvatarState,
  t: ToolState,
  ground: SimGround,
  slot: number,
  tick: number,
  out: CargoActorResult,
): void {
  let cell = t.cellGrams[t.toolCode] ?? 0;
  if (cell <= 0) {
    c.counters.formEmptyCell++;
    return;
  }
  while (cell > 0) {
    const g = cell < cfg.cargo.stackMaxGrams ? cell : cfg.cargo.stackMaxGrams;
    const id = placeFromCell(cfg, c, a, ground, slot, g, tick);
    if (id === 0) break;
    cell -= g;
    if (out.bandedFirstId === 0) out.bandedFirstId = id;
    out.bandedStacks++;
    out.bandedPucks += pucksIn(cfg, g);
  }
  t.cellGrams[t.toolCode] = cell;
  relatchCell(cfg, t);
}

/** Q tap with free hands: nearest loose resting / skidding unit within the pickup radius. Returns its id or 0. */
export function pickUp(cfg: SimConfig, c: CargoStore, a: AvatarState, ground: SimGround, slot: number): number {
  if (c.carriedCount(slot) >= cfg.cargo.carryUnits) return 0;
  feetPoint(a, cfg, ground, 0);
  const r2 = cfg.cargo.pickupRadiusM * cfg.cargo.pickupRadiusM;
  let best = -1;
  let bestD = r2;
  for (let i = 0; i < c.capacity; i++) {
    const st = c.state[i]!;
    if (st !== CARGO_RESTING && st !== CARGO_SKIDDING) continue;
    const dx = c.px[i]! - foot[0]!;
    const dy = c.py[i]! - foot[1]!;
    const dz = c.pz[i]! - foot[2]!;
    const d = dx * dx + dy * dy + dz * dz;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0) return 0;
  const keepGrams = c.grams[best]!;
  const keepCount = c.count[best]!;
  release(c, best); // leaves the loose counters (and zeroes the mass, restored below)
  c.grams[best] = keepGrams;
  c.count[best] = keepCount;
  c.state[best] = CARGO_CARRIED;
  c.carriedBy[best] = slot;
  c.order[best] = c.nextOrder++;
  return c.entityId[best]!;
}

/** Newest unit carried by `slot`, or -1. */
function newestCarried(c: CargoStore, slot: number): number {
  let best = -1;
  for (let i = 0; i < c.capacity; i++) {
    if (c.state[i] !== CARGO_CARRIED || c.carriedBy[i] !== slot) continue;
    if (best < 0 || c.order[i]! > c.order[best]!) best = i;
  }
  return best;
}

/** Q tap while carrying: drops the newest carried unit at the feet. Returns its id or 0 (cap). */
export function drop(
  cfg: SimConfig,
  c: CargoStore,
  a: AvatarState,
  ground: SimGround,
  slot: number,
  tick: number,
): number {
  const i = newestCarried(c, slot);
  if (i < 0) return 0;
  if (capFull(cfg, c, slot)) {
    c.counters.dropRejectedCap++;
    return 0;
  }
  feetPoint(a, cfg, ground, cfg.cargo.dropForwardM);
  c.px[i] = foot[0]!;
  c.py[i] = foot[1]!;
  c.pz[i] = foot[2]!;
  c.vx[i] = c.vy[i] = c.vz[i] = 0;
  setLoose(c, i, slot, CARGO_RESTING, tick);
  return c.entityId[mergeResting(cfg, c, i)]!;
}

/**
 * Q held then released while carrying: throws the newest carried unit along the camera heading `yaw` (turn units) at
 * the fixed launch pitch; speed = min + (max - min) x clamp(heldTicks / chargeTicks). Returns its id or 0.
 */
export function throwCarried(
  cfg: SimConfig,
  c: CargoStore,
  a: AvatarState,
  ground: SimGround,
  slot: number,
  yaw: number,
  heldTicks: number,
  tick: number,
): number {
  const i = newestCarried(c, slot);
  if (i < 0) return 0;
  if (capFull(cfg, c, slot)) {
    c.counters.dropRejectedCap++;
    return 0;
  }
  const T = cfg.cargo;
  let f = heldTicks / T.throwChargeTicks;
  if (f > 1) f = 1;
  const speed = T.throwMinMps + (T.throwMaxMps - T.throwMinMps) * f;
  headingBasis(a, basis);
  const cy = cosTurn(yaw);
  const sy = sinTurn(yaw);
  const fx = basis[3]! * cy + basis[6]! * sy;
  const fy = basis[4]! * cy + basis[7]! * sy;
  const fz = basis[5]! * cy + basis[8]! * sy;
  const nx = basis[0]!;
  const ny = basis[1]!;
  const nz = basis[2]!;
  feetPoint(a, cfg, ground, 0);
  c.px[i] = foot[0]! + nx * T.throwHeightM;
  c.py[i] = foot[1]! + ny * T.throwHeightM;
  c.pz[i] = foot[2]! + nz * T.throwHeightM;
  const h = speed * T.throwCos;
  const v = speed * T.throwSin;
  c.vx[i] = a.vx + fx * h + nx * v;
  c.vy[i] = a.vy + fy * h + ny * v;
  c.vz[i] = a.vz + fz * h + nz * v;
  setLoose(c, i, slot, CARGO_FLYING, tick);
  return c.entityId[i]!;
}

/** E while carrying: pours the newest carried unit back into the equipped Cell (up to capacity). Grams moved. */
export function pourBack(cfg: SimConfig, c: CargoStore, t: ToolState, slot: number): number {
  const i = newestCarried(c, slot);
  if (i < 0) return 0;
  const tool = cfg.tools[t.toolCode]!;
  if (!tool.cleans) return 0;
  const cap = actorCellCap(cfg, t, t.toolCode);
  const cell = t.cellGrams[t.toolCode] ?? 0;
  const room = cap - cell;
  if (room <= 0) return 0;
  const g = c.grams[i]! < room ? c.grams[i]! : room;
  t.cellGrams[t.toolCode] = cell + g;
  relatchCell(cfg, t);
  const left = c.grams[i]! - g;
  if (left <= 0) release(c, i);
  else {
    c.grams[i] = left;
    c.count[i] = pucksIn(cfg, left);
  }
  c.counters.pouredBackGrams += g;
  return g;
}

/**
 * Merges resting unit `i` with a resting unit it touches (combined <= stackMaxKg); the older one stays. Returns the
 * index that now holds `i`'s dust.
 */
function mergeResting(cfg: SimConfig, c: CargoStore, i: number): number {
  if (!(cfg.cargo.mergeRadiusM > 0)) return i;
  const r2 = cfg.cargo.mergeRadiusM * cfg.cargo.mergeRadiusM;
  for (let j = 0; j < c.capacity; j++) {
    if (j === i || c.state[j] !== CARGO_RESTING) continue;
    if (c.grams[i]! + c.grams[j]! > cfg.cargo.stackMaxGrams) continue;
    const dx = c.px[i]! - c.px[j]!;
    const dy = c.py[i]! - c.py[j]!;
    const dz = c.pz[i]! - c.pz[j]!;
    if (dx * dx + dy * dy + dz * dz > r2) continue;
    // Keep the older one (smaller order) in place; the newer one joins it.
    const keep = c.order[j]! < c.order[i]! ? j : i;
    const gone = keep === j ? i : j;
    c.grams[keep] = c.grams[keep]! + c.grams[gone]!;
    c.count[keep] = pucksIn(cfg, c.grams[keep]!);
    c.touchTick[keep] = c.touchTick[keep]! > c.touchTick[gone]! ? c.touchTick[keep]! : c.touchTick[gone]!;
    release(c, gone);
    c.counters.merged++;
    return keep;
  }
  return i;
}

/** Carried units follow their actor; drops everything an absent actor held (never refused). */
export function dropAllCarried(
  cfg: SimConfig,
  c: CargoStore,
  a: AvatarState,
  ground: SimGround,
  slot: number,
  tick: number,
): void {
  for (let i = 0; i < c.capacity; i++) {
    if (c.state[i] !== CARGO_CARRIED || c.carriedBy[i] !== slot) continue;
    feetPoint(a, cfg, ground, cfg.cargo.dropForwardM);
    c.px[i] = foot[0]!;
    c.py[i] = foot[1]!;
    c.pz[i] = foot[2]!;
    c.vx[i] = c.vy[i] = c.vz[i] = 0;
    setLoose(c, i, slot, CARGO_RESTING, tick);
  }
}

/**
 * World step of every unit: carried units ride at their actor's body; flying units follow a ballistic arc under lunar
 * gravity (toward the Moon centre, no drag) and land on the analytic ground; skidding units decelerate at the skid
 * rate along the ground and come to rest (then merge); resting units untouched for despawnTicks are auto-collected.
 */
export function stepCargo(
  cfg: SimConfig,
  c: CargoStore,
  avatars: readonly AvatarState[],
  ground: SimGround,
  tick: number,
): void {
  const dt = cfg.dt;
  const g = cfg.gravityMps2;
  const R = cfg.moonRadiusM;
  const skid = cfg.cargo.skidDecelMps2 * dt;
  for (let i = 0; i < c.capacity; i++) {
    const st = c.state[i]!;
    if (st === CARGO_FREE) continue;
    if (st === CARGO_CARRIED) {
      const a = avatars[c.carriedBy[i]!]!;
      c.px[i] = a.px;
      c.py[i] = a.py;
      c.pz[i] = a.pz;
      continue;
    }
    if (st === CARGO_RESTING) {
      if (tick - c.touchTick[i]! >= cfg.cargo.despawnTicks) {
        const grams = c.grams[i]!;
        c.despawnedGrams += grams;
        c.pendingGateGrams += Math.floor(grams * cfg.cargo.despawnValueFrac);
        c.counters.despawned++;
        release(c, i);
      }
      continue;
    }
    let x = c.px[i]!;
    let y = c.py[i]!;
    let z = c.pz[i]!;
    let vx = c.vx[i]!;
    let vy = c.vy[i]!;
    let vz = c.vz[i]!;
    if (st === CARGO_FLYING) {
      const l = Math.sqrt(x * x + y * y + z * z);
      const k = (g * dt) / l;
      vx -= x * k;
      vy -= y * k;
      vz -= z * k;
      x += vx * dt;
      y += vy * dt;
      z += vz * dt;
      const l2 = Math.sqrt(x * x + y * y + z * z);
      const ux = x / l2;
      const uy = y / l2;
      const uz = z / l2;
      const rg = R + ground.heightAtXYZ(ux, uy, uz);
      if (l2 <= rg) {
        // Landed: onto the ground, radial velocity removed (no bounce), skid from here.
        x = ux * rg;
        y = uy * rg;
        z = uz * rg;
        const vr = vx * ux + vy * uy + vz * uz;
        vx -= vr * ux;
        vy -= vr * uy;
        vz -= vr * uz;
        c.state[i] = CARGO_SKIDDING;
        c.touchTick[i] = tick;
      }
    } else {
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (sp <= skid) {
        vx = vy = vz = 0;
        c.state[i] = CARGO_RESTING;
        c.touchTick[i] = tick;
      } else {
        const m = (sp - skid) / sp;
        vx *= m;
        vy *= m;
        vz *= m;
        x += vx * dt;
        y += vy * dt;
        z += vz * dt;
        const l2 = Math.sqrt(x * x + y * y + z * z);
        const ux = x / l2;
        const uy = y / l2;
        const uz = z / l2;
        const rg = R + ground.heightAtXYZ(ux, uy, uz);
        x = ux * rg;
        y = uy * rg;
        z = uz * rg;
        const vr = vx * ux + vy * uy + vz * uz;
        vx -= vr * ux;
        vy -= vr * uy;
        vz -= vr * uz;
      }
    }
    c.px[i] = x;
    c.py[i] = y;
    c.pz[i] = z;
    c.vx[i] = vx;
    c.vy[i] = vy;
    c.vz[i] = vz;
    if (c.state[i] === CARGO_RESTING) mergeResting(cfg, c, i);
  }
}

/** True when unit `i` lies loose (resting, flying or skidding). */
export function isLooseUnit(c: CargoStore, i: number): boolean {
  return isLoose(c.state[i]!);
}

/** Removes loose unit `i` from the world (sold at a Gate) and returns its grams; 0 when it is not loose. */
export function takeLooseUnit(c: CargoStore, i: number): number {
  if (!isLoose(c.state[i]!)) return 0;
  const g = c.grams[i]!;
  release(c, i);
  return g;
}
