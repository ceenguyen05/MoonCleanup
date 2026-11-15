// Near Parcels and outpost bearings into the compass (integrator round 5, follow-up). The UI keeps its own typed
// parcels store (`UiModule.setNearParcels` / `setOutpostBearing`); this feed reads the Solo worker's cached read-outs
// (sim-host/readouts.ts) at most 10 Hz and turns each unit direction into a compass bearing from the avatar's position
// (`sphereBearingDeg`, world north = +Y: ICO_NORTH in packages/world). The UI store only publishes on a changed value, and
// the buffers here are reused, so a frame without change allocates nothing. Without a source (online, no host) it stays
// idle and leaves the last values.

import { HUD_WRITE_HZ } from "./hud-writer";

interface Dir {
  x: number;
  y: number;
  z: number;
}

/** What the feed reads: `HostReadouts` (Solo cache); also the shape of `MoonRoomSim`'s parcel / outpost helpers. */
export interface ParcelReadoutSource {
  readonly nearParcelCount: number;
  nearParcel(k: number, out: Dir): boolean;
  readonly outpostCount: number;
  outpost(k: number, out: Dir & { id: string }): boolean;
}

/** The UI module's feed methods (`UiModule` satisfies this). */
export interface ParcelUiTarget {
  setNearParcels(
    source: { readonly nearParcelCount: number; nearParcel(k: number, out: Dir): boolean },
    bearing?: (dir: Readonly<Dir>) => number | null,
  ): void;
  setOutpostBearing(id: string, bearingDeg: number | null): void;
}

export interface ParcelFeedOptions {
  readonly ui: ParcelUiTarget;
  readonly source: () => ParcelReadoutSource | null;
  /** Avatar position (any scale, from the moon centre) into `out`; false before the first pose. */
  readonly samplePos: (out: Dir) => boolean;
  /** `sphereBearingDeg` (unit position, unit direction -> degrees or null). */
  readonly bearing: (p: Readonly<Dir>, d: Readonly<Dir>) => number | null;
}

export class ParcelFeed {
  private readonly minIntervalMs = 1000 / HUD_WRITE_HZ;
  private lastMs = Number.NEGATIVE_INFINITY;
  private readonly pos: Dir = { x: 0, y: 1, z: 0 };
  private readonly unit: Dir = { x: 0, y: 1, z: 0 };
  private readonly outpost: Dir & { id: string } = { id: "", x: 0, y: 1, z: 0 };
  private readonly bearingFn = (dir: Readonly<Dir>): number | null => this.options.bearing(this.unit, dir);

  constructor(private readonly options: ParcelFeedOptions) {}

  /** Once per frame (before the store flush). */
  pump(nowMs: number): void {
    if (nowMs - this.lastMs < this.minIntervalMs) return;
    const src = this.options.source();
    if (src === null) return;
    this.lastMs = nowMs;
    const p = this.pos;
    if (!this.options.samplePos(p)) return;
    const len = Math.hypot(p.x, p.y, p.z);
    if (!(len > 0)) return;
    this.unit.x = p.x / len;
    this.unit.y = p.y / len;
    this.unit.z = p.z / len;
    this.options.ui.setNearParcels(src, this.bearingFn);
    const o = this.outpost;
    for (let k = 0, n = src.outpostCount; k < n; k++) {
      if (src.outpost(k, o)) this.options.ui.setOutpostBearing(o.id, this.options.bearing(this.unit, o));
    }
  }
}
