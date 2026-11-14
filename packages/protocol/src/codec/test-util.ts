// Test helpers: a seeded PRNG and an allocation probe. Not exported from the package barrel.

import { AVATAR_ACTION_STATES } from "@moon-cleanup/shared";
// Test-only helper (imported by *.test.ts only, never by the barrel): Node is allowed in tests, not in package sources.
// eslint-disable-next-line no-restricted-imports
import { getHeapStatistics } from "node:v8";
import {
  ENTITY_KIND_AVATAR,
  createEntityState,
  createSelfState,
  type EntityState,
  type SelfState,
} from "./frame-state";

/** mulberry32: small, fast, deterministic. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(r: () => number, min: number, max: number): number {
  return min + Math.floor(r() * (max - min + 1));
}

/**
 * V8 accounts `total_allocated_bytes` in allocation-buffer chunks and JIT tier-up allocates feedback and code objects
 * on the heap, so a single run shows noise of 0.2 to 7 MB regardless of what `fn` does (measured under vitest). A real
 * per-call allocation shows in EVERY run, so `allocatedBytes` returns the MINIMUM of several runs; with
 * ALLOC_ITERATIONS calls per run, even 40 B per call exceeds ALLOC_BUDGET_BYTES.
 */
export const ALLOC_ITERATIONS = 40_000;
export const ALLOC_BUDGET_BYTES = 1_200_000;

/** Minimum bytes allocated by `runs` runs of `iterations` calls of `fn`, after a warm-up (V8 `total_allocated_bytes`). */
export function allocatedBytes(fn: () => void, iterations = ALLOC_ITERATIONS, runs = 3): number {
  for (let i = 0; i < 10_000; i++) fn();
  let best = Number.POSITIVE_INFINITY;
  for (let r = 0; r < runs; r++) {
    const before = getHeapStatistics().total_allocated_bytes;
    for (let i = 0; i < iterations; i++) fn();
    const used = getHeapStatistics().total_allocated_bytes - before;
    if (used < best) best = used;
  }
  return best;
}

export function randomSelf(r: () => number): SelfState {
  const s = createSelfState();
  s.moveState = randInt(r, 0, 5);
  s.hopCharges = randInt(r, 0, 7);
  s.px = (r() - 0.5) * 8000;
  s.py = (r() - 0.5) * 8000;
  s.pz = (r() - 0.5) * 8000;
  s.vx = (r() - 0.5) * 250;
  s.vy = (r() - 0.5) * 250;
  s.vz = (r() - 0.5) * 250;
  s.yawCode = randInt(r, 0, 1023);
  s.cellGrams = randInt(r, 0, 0xffffff);
  s.vpx = (r() - 0.5) * 8000;
  s.vpy = (r() - 0.5) * 8000;
  s.vpz = (r() - 0.5) * 8000;
  s.orientIndex = randInt(r, 0, 3);
  s.orientA = randInt(r, -16384, 16383);
  s.orientB = randInt(r, -16384, 16383);
  s.orientC = randInt(r, -16384, 16383);
  s.lvx = (r() - 0.5) * 250;
  s.lvy = (r() - 0.5) * 250;
  s.lvz = (r() - 0.5) * 250;
  s.avx = (r() - 0.5) * 250;
  s.avy = (r() - 0.5) * 250;
  s.avz = (r() - 0.5) * 250;
  s.steer = randInt(r, -128, 127);
  s.gear = randInt(r, 0, 3);
  s.boost = r() < 0.5;
  s.lights = r() < 0.5;
  return s;
}

export function randomEntity(
  r: () => number,
  slot: number,
  kind: number,
  rec: number,
  near?: EntityState,
): EntityState {
  const e = createEntityState();
  e.slot = slot;
  e.kind = kind;
  e.rec = rec;
  const spread = near ? [0.4, 20, 300][randInt(r, 0, 2)]! : 6000;
  const base = near ?? { px: 0, py: 0, pz: 0 };
  e.px = base.px + (r() - 0.5) * spread;
  e.py = base.py + (r() - 0.5) * spread;
  e.pz = base.pz + (r() - 0.5) * spread;
  if (r() < 0.2 && near) {
    e.px = near.px;
    e.py = near.py;
  }
  e.yawCode = randInt(r, 0, 1023);
  e.pitchCode = randInt(r, 0, 63);
  e.actionState = randInt(r, 0, AVATAR_ACTION_STATES.length - 1);
  e.toolIndex = randInt(r, 0, 15);
  e.flags = kind === ENTITY_KIND_AVATAR ? randInt(r, 0, 63) : randInt(r, 0, 255);
  e.orientIndex = randInt(r, 0, 3);
  e.orientA = randInt(r, -512, 511);
  e.orientB = randInt(r, -512, 511);
  e.orientC = randInt(r, -512, 511);
  e.steerCode = randInt(r, -32, 31);
  e.speedCode = randInt(r, 0, 255);
  e.driverSlot = randInt(r, 0, 255);
  e.headingCode = randInt(r, 0, 255);
  e.robotState = randInt(r, 0, 8);
  e.cargo = randInt(r, 0, 7);
  return e;
}
