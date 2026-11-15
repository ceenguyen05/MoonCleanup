// PUCKS section body (save/format section id 8, owned by packages/sim): every Dust Puck / Puck Stack and the per-actor
// F / Q hold state, so a restored sim continues bit for bit. Untrusted input: decoded into a fresh CargoStore and
// validated completely before the room commits it (a failure leaves the room untouched). Allocation is allowed here
// (host calls between ticks).
//
// PUCKS v3 (v2 is the empty interim body of the shared save vectors; v1 unused)
//   u32 nextId, u32 nextOrder, f64 despawnedGrams, f64 pendingGateGrams
//   MAX_PLAYERS_PER_ROOM x (i32 formHeld, u8 formBanded, i32 qHeld)
//   u16 count, then `count` records:
//   u8 state (1 resting, 2 flying, 3 skidding, 4 carried), i8 carriedBy, i8 owner, u32 entityId, u16 count,
//   i32 grams, i32 touchTick, i32 order, 6 x f64 px py pz vx vy vz
//
// A carried unit whose actor is not joined at restore is put down where it was (resting). The loose caps are not
// enforced on restore (a tuning change must never destroy a save); counters are rebuilt from the records.

import { MAX_PLAYERS_PER_ROOM } from "@moon-cleanup/shared";
import type { SimConfig } from "../config/sim-config";
import { CheckpointFail, CheckpointReader, CheckpointWriter } from "../room/checkpoint";
import {
  CARGO_CARRIED,
  CARGO_ENTITY_ID_BASE,
  CARGO_FLYING,
  CARGO_FREE,
  CARGO_RESTING,
  CARGO_SKIDDING,
  CargoStore,
} from "./pucks";

export const SIM_CHECKPOINT_PUCKS_VERSION = 3;
export const SIM_CHECKPOINT_PUCKS_MAX_BYTES = 32768;
const HEADER_BYTES = 4 + 4 + 8 + 8 + MAX_PLAYERS_PER_ROOM * 9 + 2;
const RECORD_BYTES = 1 + 1 + 1 + 4 + 2 + 4 + 4 + 4 + 6 * 8;

export function encodeCheckpointPucks(c: CargoStore): Uint8Array {
  let n = 0;
  for (let i = 0; i < c.capacity; i++) if (c.state[i] !== CARGO_FREE) n++;
  const w = new CheckpointWriter(HEADER_BYTES + n * RECORD_BYTES);
  w.u32(c.nextId >>> 0);
  w.u32(c.nextOrder >>> 0);
  w.f64(c.despawnedGrams);
  w.f64(c.pendingGateGrams);
  for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
    w.i32(c.formHeld[s]!);
    w.u8(c.formBanded[s]!);
    w.i32(c.qHeld[s]!);
  }
  w.u16(n);
  for (let i = 0; i < c.capacity; i++) {
    if (c.state[i] === CARGO_FREE) continue;
    w.u8(c.state[i]!);
    w.i8(c.carriedBy[i]!);
    w.i8(c.owner[i]!);
    w.u32(c.entityId[i]! >>> 0);
    w.u16(c.count[i]!);
    w.i32(c.grams[i]!);
    w.i32(c.touchTick[i]!);
    w.i32(c.order[i]!);
    w.f64(c.px[i]!);
    w.f64(c.py[i]!);
    w.f64(c.pz[i]!);
    w.f64(c.vx[i]!);
    w.f64(c.vy[i]!);
    w.f64(c.vz[i]!);
  }
  return w.finish();
}

const isSlot = (v: number): boolean => v >= 0 && v < MAX_PLAYERS_PER_ROOM;

/** Decodes and validates a PUCKS body into a fresh store. `active[s]` = slot s is joined. */
export function decodeCheckpointPucks(
  cfg: SimConfig,
  bytes: Uint8Array,
  active: readonly boolean[],
): CargoStore | CheckpointFail {
  if (bytes.length > SIM_CHECKPOINT_PUCKS_MAX_BYTES) return new CheckpointFail("oversize", "pucks");
  const r = new CheckpointReader(bytes);
  const c = new CargoStore(cfg);
  c.nextId = r.u32();
  c.nextOrder = r.u32();
  c.despawnedGrams = r.f64();
  c.pendingGateGrams = r.f64();
  for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
    c.formHeld[s] = r.i32();
    c.formBanded[s] = r.u8();
    c.qHeld[s] = r.i32();
  }
  const n = r.u16();
  if (r.failed) return new CheckpointFail("malformed", "pucks");
  if (n > c.capacity) return new CheckpointFail("out_of_range", "pucks.count");
  if (!(c.nextId >= CARGO_ENTITY_ID_BASE && c.nextId < 0x7fffffff && c.nextOrder >= 1 && c.nextOrder < 0x7fffffff)) {
    return new CheckpointFail("out_of_range", "pucks.next");
  }
  if (!(Number.isFinite(c.despawnedGrams) && c.despawnedGrams >= 0))
    return new CheckpointFail("out_of_range", "pucks.despawned");
  if (!(Number.isFinite(c.pendingGateGrams) && c.pendingGateGrams >= 0))
    return new CheckpointFail("out_of_range", "pucks.pending");
  for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
    if (c.formHeld[s]! < -1 || c.qHeld[s]! < -1 || c.formBanded[s]! > 1)
      return new CheckpointFail("out_of_range", "pucks.hold");
  }
  const ids = new Set<number>();
  const maxR = cfg.moonRadiusM * 2;
  for (let i = 0; i < n; i++) {
    let st = r.u8();
    let by = r.i8();
    const owner = r.i8();
    const id = r.u32();
    r.u16(); // stored puck count: re-derived from grams below
    const grams = r.i32();
    const touch = r.i32();
    const order = r.i32();
    const px = r.f64();
    const py = r.f64();
    const pz = r.f64();
    const vx = r.f64();
    const vy = r.f64();
    const vz = r.f64();
    if (r.failed) return new CheckpointFail("malformed", "pucks");
    if (!(st >= CARGO_RESTING && st <= CARGO_CARRIED)) return new CheckpointFail("out_of_range", "pucks.state");
    if (st === CARGO_CARRIED ? !isSlot(by) : by !== -1) return new CheckpointFail("out_of_range", "pucks.carriedBy");
    if (!isSlot(owner) && !(owner === -1 && st === CARGO_CARRIED))
      return new CheckpointFail("out_of_range", "pucks.owner");
    if (!(id >= CARGO_ENTITY_ID_BASE && id < c.nextId) || ids.has(id))
      return new CheckpointFail("out_of_range", "pucks.id");
    ids.add(id);
    if (!(grams > 0 && order >= 0 && order < c.nextOrder)) return new CheckpointFail("out_of_range", "pucks.grams");
    const reals = [px, py, pz, vx, vy, vz];
    if (
      !reals.every(Number.isFinite) ||
      Math.hypot(px, py, pz) > maxR ||
      Math.hypot(px, py, pz) < cfg.moonRadiusM / 2
    ) {
      return new CheckpointFail("out_of_range", "pucks.pose");
    }
    if (st === CARGO_CARRIED && !active[by]) {
      // Its actor is not here: put it down where it was.
      st = CARGO_RESTING;
      by = -1;
    }
    c.state[i] = st;
    c.carriedBy[i] = by;
    c.owner[i] = st === CARGO_CARRIED ? owner : isSlot(owner) ? owner : by;
    c.entityId[i] = id;
    c.grams[i] = grams;
    c.count[i] = Math.max(1, Math.ceil(grams / cfg.cargo.puckGrams));
    c.touchTick[i] = touch;
    c.order[i] = order;
    c.px[i] = px;
    c.py[i] = py;
    c.pz[i] = pz;
    const moving = st === CARGO_FLYING || st === CARGO_SKIDDING;
    c.vx[i] = moving ? vx : 0;
    c.vy[i] = moving ? vy : 0;
    c.vz[i] = moving ? vz : 0;
    if (st !== CARGO_CARRIED) {
      c.loose++;
      c.looseBy[c.owner[i]!]!++;
    }
  }
  if (!r.done) return new CheckpointFail("malformed", "pucks");
  return c;
}
