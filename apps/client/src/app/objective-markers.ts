// Objective marker for the active Induction step (HUD-03): `compass.objectiveMarkerId` plus the whole-degree bearing of
// the place on the compass track (`ParcelsStore.setMarkerBearing`). Runs at most HUD_WRITE_HZ from the existing UI pump,
// reuses its scratch vectors, and writes only on change; with no active step it clears the marker once.
//
// Places come from the Solo read-out cache (outposts, Near Parcels) and the station list (Assay Counter, Desk). The sim has
// `apronPlot` read-out on its source (sim `MoonRoomSim.apronPlot`, nearest plot); a source without it (the host cache has not
// forwarded it yet) falls back to the home outpost the Apron surrounds (Boreal, outpost 0). Label text is the UI catalog's. Steps with no place (fill Cell, open Plot Card) show no marker.

import type { UiStore } from "@moon-cleanup/shared";
import { HUD_WRITE_HZ } from "./hud-writer";
import type { ParcelReadoutSource } from "./parcel-feed";

interface Dir {
  x: number;
  y: number;
  z: number;
}

export interface MarkerStation {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

type Place = "home_outpost" | "assay_counter" | "desk" | "near_parcel";

/** Induction step id -> marker id (a key of the UI catalog's `compass.objectives`) and where it points. */
export const STEP_MARKERS: Readonly<Record<string, { readonly markerId: string; readonly place: Place }>> = {
  "onboarding.first_stroke": { markerId: "landing_apron", place: "home_outpost" },
  "onboarding.pour_at_counter": { markerId: "assay_counter", place: "assay_counter" },
  "onboarding.polish_apron_plot": { markerId: "landing_apron", place: "home_outpost" },
  "onboarding.buy_crescent_squeegee": { markerId: "requisitions_desk", place: "desk" },
  "onboarding.buy_dust_cell": { markerId: "requisitions_desk", place: "desk" },
  "onboarding.find_near_parcel": { markerId: "near_parcel", place: "near_parcel" },
};

export interface ObjectiveMarkersOptions {
  readonly store: Pick<UiStore, "dispatch" | "getState">;
  /** `ParcelsStore.setMarkerBearing` through the UI module. */
  readonly setMarkerBearing: (id: string, bearingDeg: number | null) => void;
  /** Active Induction step id, or null (none, complete, or no checklist yet). */
  readonly step: () => string | null;
  readonly source: () => ParcelReadoutSource | null;
  readonly stations: () => readonly MarkerStation[];
  /** Avatar position (any scale) into `out`; false before the first pose. */
  readonly samplePos: (out: Dir) => boolean;
  /** `simHeadingBearingDeg` (sim heading frame; `sphereBearingDeg` is wrong near the poles). */
  readonly bearing: (p: Readonly<Dir>, d: Readonly<Dir>) => number | null;
  /** Moon radius in metres (`gameData.world.moonRadiusM`); without it no distance is written. */
  readonly moonRadiusM?: number;
}

export class ObjectiveMarkers {
  private readonly minIntervalMs = 1000 / HUD_WRITE_HZ;
  private lastMs = Number.NEGATIVE_INFINITY;
  private activeId: string | null = null;
  private lastDistance: number | null = null;
  private readonly pos: Dir = { x: 0, y: 1, z: 0 };
  private readonly target: Dir = { x: 0, y: 1, z: 0 };
  private readonly scratch: Dir & { id: string } = { id: "", x: 0, y: 1, z: 0 };

  constructor(private readonly o: ObjectiveMarkersOptions) {}

  pump(nowMs: number): void {
    if (nowMs - this.lastMs < this.minIntervalMs) return;
    this.lastMs = nowMs;
    const stepId = this.o.step();
    const def = stepId === null ? undefined : STEP_MARKERS[stepId];
    if (def === undefined) {
      this.clear();
      return;
    }
    if (this.activeId !== def.markerId) {
      if (this.activeId !== null) this.o.setMarkerBearing(this.activeId, null);
      this.activeId = def.markerId;
      this.o.store.dispatch({ type: "compass.set", patch: { objectiveMarkerId: def.markerId } });
    }
    const p = this.pos;
    if (!this.o.samplePos(p)) return;
    const len = Math.hypot(p.x, p.y, p.z);
    if (!(len > 0)) return;
    p.x /= len;
    p.y /= len;
    p.z /= len;
    if (!this.locate(def.place, p)) {
      this.o.setMarkerBearing(def.markerId, null);
      this.setDistance(null);
      return;
    }
    this.o.setMarkerBearing(def.markerId, this.o.bearing(p, this.target));
    this.setDistance(this.distanceM(p));
  }

  /** Great-circle distance to `target` in whole metres, or null without a moon radius. `from` is a unit vector. */
  private distanceM(from: Readonly<Dir>): number | null {
    const r = this.o.moonRadiusM;
    if (r === undefined || !(r > 0)) return null;
    const t = this.target;
    const tl = Math.hypot(t.x, t.y, t.z);
    if (!(tl > 0)) return null;
    const dot = (from.x * t.x + from.y * t.y + from.z * t.z) / tl;
    return Math.round(r * Math.acos(dot > 1 ? 1 : dot < -1 ? -1 : dot));
  }

  /** Change-only write of `compass.objectiveDistanceM` (no allocation while the value holds). */
  private setDistance(m: number | null): void {
    if (m === this.lastDistance) return;
    this.lastDistance = m;
    this.o.store.dispatch({ type: "compass.set", patch: { objectiveDistanceM: m } });
  }

  private clear(): void {
    if (this.activeId === null) return;
    this.o.setMarkerBearing(this.activeId, null);
    this.activeId = null;
    this.o.store.dispatch({ type: "compass.set", patch: { objectiveMarkerId: null } });
    this.setDistance(null);
  }

  /** Writes the unit direction of `place` into `target`; false when it is unknown. */
  private locate(place: Place, from: Readonly<Dir>): boolean {
    const t = this.target;
    if (place === "assay_counter" || place === "desk") {
      const s = this.o.stations().find((st) => st.kind === place);
      if (s === undefined) return false;
      t.x = s.x;
      t.y = s.y;
      t.z = s.z;
      return true;
    }
    const src = this.o.source();
    if (src === null) return false;
    if (place === "home_outpost") {
      // The nearest Landing Apron plot when the source reports them (sim `apronPlot`); else the home pad they surround.
      if (src.apronPlot !== undefined && src.apronPlotCount !== undefined) {
        let best = -2;
        for (let k = 0, n = src.apronPlotCount; k < n; k++) {
          if (!src.apronPlot(k, this.scratch)) continue;
          const d = this.scratch.x * from.x + this.scratch.y * from.y + this.scratch.z * from.z;
          if (d > best) {
            best = d;
            t.x = this.scratch.x;
            t.y = this.scratch.y;
            t.z = this.scratch.z;
          }
        }
        if (best > -2) return true;
      }
      if (src.outpostCount < 1 || !src.outpost(0, this.scratch)) return false;
      t.x = this.scratch.x;
      t.y = this.scratch.y;
      t.z = this.scratch.z;
      return true;
    }
    // Nearest uncollected Near Parcel (largest dot product of unit directions).
    let best = -2;
    for (let k = 0, n = src.nearParcelCount; k < n; k++) {
      if (src.nearParcel(k, this.scratch)) continue; // collected
      const d = this.scratch.x * from.x + this.scratch.y * from.y + this.scratch.z * from.z;
      if (d > best) {
        best = d;
        t.x = this.scratch.x;
        t.y = this.scratch.y;
        t.z = this.scratch.z;
      }
    }
    return best > -2;
  }
}

/**
 * The UI module's marker setter, when it has one. `UiModule` exposes `setOutpostBearing` today; `ParcelsStore.setMarkerBearing`
 * is not yet forwarded (returned to the UI owner in the W7-T03 wiring report). Until it is, the sink warns once and drops the
 * bearing (the objective label still shows from `compass.objectiveMarkerId`).
 */
export function markerSink(
  ui: object,
  warn: (message: string) => void,
): (id: string, bearingDeg: number | null) => void {
  if ("setMarkerBearing" in ui && typeof ui.setMarkerBearing === "function") {
    const fn = ui.setMarkerBearing as (this: object, id: string, bearingDeg: number | null) => void;
    return (id, deg) => fn.call(ui, id, deg);
  }
  let warned = false;
  return () => {
    if (warned) return;
    warned = true;
    warn("UiModule.setMarkerBearing is missing: objective marker bearings are not drawn");
  };
}
