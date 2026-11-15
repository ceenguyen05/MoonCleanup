// Stray Cargo: MVP Near Parcels (scope-tiers section 1 "Exploration"; progression-and-economy section 15): a few small
// parcels seeded around Outpost Boreal. Walking over one (within the cargo `pickupRadiusM`) pays its Lumens into the
// shift wallet once and emits `collectible.found`.
//
// Placement is deterministic per Contract (FNV-1a of the contract id seeds a splitmix32 stream) and uses the sim's
// table trig, so the server, the Solo worker and tests place the same parcels on every engine. Bearings are spread
// evenly with jitter; distance is area-uniform between the compound edge and the MVP radius.

import { radiansToTurn, cosTurn, sinTurn } from "../math/trig";

/** Stray Cargo size the MVP places (collectibles.json `strayCargo[].size`). */
export const NEAR_PARCEL_SIZE = "near_parcel";
/** Save key of the collected Near Parcels (bitmask) in the META key list. */
export const NEAR_PARCEL_SAVE_KEY = "strayCargo.near_parcel";
/** Placement band around the Boreal pad (section 15: "within 300 m"; the inner edge keeps them off the compound). */
export const NEAR_PARCEL_MIN_M = 30;
export const NEAR_PARCEL_MAX_M = 300;

/** FNV-1a 32 of a string (seed of the Contract's placements). */
export function seedOfString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Unit directions of `count` Near Parcels around the pole pad (0, 1, 0), written as x, y, z triples into `out`
 * (length >= 3 x count).
 */
export function placeNearParcels(seed: number, count: number, moonRadiusM: number, out: Float64Array): void {
  let state = seed | 0;
  const next = (): number => {
    state = (state + 0x9e3779b9) | 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    z ^= z >>> 16;
    return (z >>> 0) / 4294967296;
  };
  const span2 = NEAR_PARCEL_MAX_M * NEAR_PARCEL_MAX_M - NEAR_PARCEL_MIN_M * NEAR_PARCEL_MIN_M;
  for (let k = 0; k < count; k++) {
    const bearing = radiansToTurn((2 * Math.PI * (k + 0.8 * next())) / count);
    const distM = Math.sqrt(NEAR_PARCEL_MIN_M * NEAR_PARCEL_MIN_M + next() * span2);
    const ang = radiansToTurn(distM / moonRadiusM);
    const sa = sinTurn(ang);
    out[3 * k] = sa * cosTurn(bearing);
    out[3 * k + 1] = cosTurn(ang);
    out[3 * k + 2] = sa * sinTurn(bearing);
  }
}
