// Near Parcels (HUD, compass): a UI-local typed external store, read with `useSyncExternalStore` selectors, written only
// through its setters. It carries what the compass needs and the shared `compass` slice has no room for: how many Near
// Parcels the Contract has, which are collected, the whole-degree bearing of each uncollected one, and the bearing of each
// outpost. (A shared `compass.nearParcels` field would be the cleaner long-term home: ask contracts-architect.)
//
// Data shape: `MoonRoomSim.nearParcelCount` / `nearParcel(k, out)` (unit direction into `out`, returns "collected"). The
// setter reads the sim through a structural port, with one reused scratch vector and reused Int16 buffers, and replaces
// the immutable snapshot only when the count, the collected mask or a whole-degree bearing changed, so a 10 Hz feed costs
// no allocation and no React render while nothing moves.

import { createContext, useContext, useSyncExternalStore } from "react";

/** Most parcels a Contract can hold (the sim caps at 8; the MVP has 6). */
export const NEAR_PARCEL_MAX = 8;
/** Lumens per Near Parcel (MVP scope). Display default only; the feed may pass the real value. */
export const NEAR_PARCEL_REWARD_LM = 30;

export interface ParcelDir {
  x: number;
  y: number;
  z: number;
}

/** What the store reads from the sim: `MoonRoomSim` satisfies this with no cast. */
export interface NearParcelSource {
  readonly nearParcelCount: number;
  nearParcel(k: number, out: ParcelDir): boolean;
}

/** Turns a parcel's unit direction into a compass bearing in degrees (0 = north, clockwise), or `null` when unknown. */
export type ParcelBearingFn = (dir: Readonly<ParcelDir>) => number | null;

export interface ParcelsState {
  /** Parcels on this Contract (0 = none: the HUD shows nothing). */
  readonly count: number;
  /** Bit k set = parcel k collected. */
  readonly collectedMask: number;
  readonly collected: number;
  readonly rewardLm: number;
  /** Whole-degree bearing (0..359) per parcel; `null` = collected or unknown. Length = `count`. */
  readonly bearings: readonly (number | null)[];
  /** Whole-degree bearing per outpost id. */
  readonly outposts: Readonly<Record<string, number>>;
}

export interface ParcelsStore {
  readonly getState: () => ParcelsState;
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Reads every parcel from `source` (no allocation after the first call). `bearing` converts a direction into the
   * player-relative-free compass bearing; without it the chip still counts parcels but no marker is drawn.
   */
  readonly setNearParcels: (source: NearParcelSource, bearing?: ParcelBearingFn, rewardLm?: number) => void;
  /** Bearing of an outpost on the compass track; `null` removes it. Rounded to whole degrees. */
  readonly setOutpostBearing: (id: string, bearingDeg: number | null) => void;
  /** Contract reset / leaving the shift. */
  readonly clear: () => void;
}

const NONE = -1;
const EMPTY: ParcelsState = {
  count: 0,
  collectedMask: 0,
  collected: 0,
  rewardLm: NEAR_PARCEL_REWARD_LM,
  bearings: [],
  outposts: {},
};

export function normalizeDeg(deg: number): number {
  const wrapped = Math.round(deg) % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped + 0; // `+ 0` turns -0 into 0
}

/**
 * Compass bearing from the unit position `p` toward the unit direction `d` on a sphere whose north pole is +Y. Pure
 * convenience for the feed; returns `null` at a pole (undefined north) or when `d` is straight overhead / underfoot.
 */
export function sphereBearingDeg(p: Readonly<ParcelDir>, d: Readonly<ParcelDir>): number | null {
  // North tangent at p: Y minus its component along p.
  const nx = -p.y * p.x;
  const ny = 1 - p.y * p.y;
  const nz = -p.y * p.z;
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen < 1e-6) return null;
  const ux = nx / nLen;
  const uy = ny / nLen;
  const uz = nz / nLen;
  // East = north x p.
  const ex = uy * p.z - uz * p.y;
  const ey = uz * p.x - ux * p.z;
  const ez = ux * p.y - uy * p.x;
  // Tangent part of d.
  const dot = d.x * p.x + d.y * p.y + d.z * p.z;
  const tx = d.x - dot * p.x;
  const ty = d.y - dot * p.y;
  const tz = d.z - dot * p.z;
  if (Math.hypot(tx, ty, tz) < 1e-6) return null;
  const east = tx * ex + ty * ey + tz * ez;
  const north = tx * ux + ty * uy + tz * uz;
  return normalizeDeg((Math.atan2(east, north) * 180) / Math.PI);
}

export function createParcelsStore(): ParcelsStore {
  let state: ParcelsState = EMPTY;
  const listeners = new Set<() => void>();
  const bearingBuf = new Int16Array(NEAR_PARCEL_MAX).fill(NONE);
  const scratch: ParcelDir = { x: 0, y: 0, z: 0 };
  const publish = (next: ParcelsState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setNearParcels: (source, bearing, rewardLm = state.rewardLm) => {
      const count = Math.max(0, Math.min(NEAR_PARCEL_MAX, Math.floor(source.nearParcelCount)));
      let mask = 0;
      let changed = count !== state.count || rewardLm !== state.rewardLm;
      for (let k = 0; k < count; k++) {
        const done = source.nearParcel(k, scratch);
        if (done) mask |= 1 << k;
        const deg = done || bearing === undefined ? null : bearing(scratch);
        const q = deg === null || !Number.isFinite(deg) ? NONE : normalizeDeg(deg);
        if (bearingBuf[k] !== q) {
          bearingBuf[k] = q;
          changed = true;
        }
      }
      for (let k = count; k < NEAR_PARCEL_MAX; k++) bearingBuf[k] = NONE;
      if (mask !== state.collectedMask) changed = true;
      if (!changed) return;
      const bearings: (number | null)[] = [];
      let collected = 0;
      for (let k = 0; k < count; k++) {
        bearings.push(bearingBuf[k] === NONE ? null : (bearingBuf[k] as number));
        if (((mask >>> k) & 1) === 1) collected++;
      }
      publish({ ...state, count, collectedMask: mask, collected, rewardLm, bearings });
    },
    setOutpostBearing: (id, bearingDeg) => {
      const current = state.outposts[id];
      if (bearingDeg === null || !Number.isFinite(bearingDeg)) {
        if (current === undefined) return;
        const rest = { ...state.outposts };
        delete rest[id];
        publish({ ...state, outposts: rest });
        return;
      }
      const q = normalizeDeg(bearingDeg);
      if (current === q) return;
      publish({ ...state, outposts: { ...state.outposts, [id]: q } });
    },
    clear: () => {
      bearingBuf.fill(NONE);
      if (state === EMPTY) return;
      publish(EMPTY);
    },
  };
}

export const ParcelsContext = createContext<ParcelsStore>(createParcelsStore());

export function useParcels<T>(selector: (state: ParcelsState) => T): T {
  const store = useContext(ParcelsContext);
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}
