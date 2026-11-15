import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EventBus } from "@moon-cleanup/shared";
import { createUiStore } from "../../app/ui-store";
import { UiProvider } from "../ui-context";
import { CompassStrip } from "./CompassStrip";
import {
  createParcelsStore,
  normalizeDeg,
  ParcelsContext,
  sphereBearingDeg,
  type NearParcelSource,
  type ParcelDir,
  type ParcelsStore,
} from "./parcels-store";

/** A fake of `MoonRoomSim.nearParcelCount` / `nearParcel(k, out)`: 6 parcels, `mask` = collected bits. */
function fakeSim(mask: number, dirs: readonly ParcelDir[]): NearParcelSource & { reads: number } {
  const sim = {
    reads: 0,
    nearParcelCount: dirs.length,
    nearParcel(k: number, out: ParcelDir): boolean {
      sim.reads++;
      const d = dirs[k] as ParcelDir;
      out.x = d.x;
      out.y = d.y;
      out.z = d.z;
      return ((mask >>> k) & 1) === 1;
    },
  };
  return sim;
}

const SIX: readonly ParcelDir[] = Array.from({ length: 6 }, (_, k) => ({ x: k, y: 0, z: 1 }));
const bearingOfX: (d: Readonly<ParcelDir>) => number = (d) => d.x * 10; // 0,10,..,50

function render(parcels: ParcelsStore): string {
  const store = createUiStore();
  store.flush(1000);
  const win = {
    matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
  };
  return renderToStaticMarkup(
    <UiProvider
      store={store}
      events={{} as EventBus}
      host={{} as HTMLElement}
      win={win as unknown as Window}
      motion="full"
      glass="auto"
    >
      <ParcelsContext.Provider value={parcels}>
        <CompassStrip />
      </ParcelsContext.Provider>
    </UiProvider>,
  );
}

describe("Near Parcels store", () => {
  it("reads count, collected mask and whole-degree bearings from the sim shape", () => {
    const store = createParcelsStore();
    store.setNearParcels(fakeSim(0b000101, SIX), bearingOfX, 30);
    const s = store.getState();
    expect(s.count).toBe(6);
    expect(s.collected).toBe(2);
    expect(s.rewardLm).toBe(30);
    expect(s.bearings).toEqual([null, 10, null, 30, 40, 50]); // collected parcels have no marker
  });
  it("replaces the snapshot only on change (no render, no allocation churn at 10 Hz)", () => {
    const store = createParcelsStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const sim = fakeSim(0, SIX);
    store.setNearParcels(sim, bearingOfX);
    const first = store.getState();
    for (let i = 0; i < 20; i++) store.setNearParcels(sim, bearingOfX);
    expect(store.getState()).toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);
    store.setNearParcels(fakeSim(0b1, SIX), bearingOfX);
    expect(store.getState()).not.toBe(first);
    expect(listener).toHaveBeenCalledTimes(2);
  });
  it("sub-degree bearing jitter does not publish; a whole degree does", () => {
    const store = createParcelsStore();
    let deg = 100.2;
    const sim = fakeSim(0, [{ x: 1, y: 0, z: 0 }]);
    store.setNearParcels(sim, () => deg);
    const first = store.getState();
    deg = 100.4;
    store.setNearParcels(sim, () => deg);
    expect(store.getState()).toBe(first);
    deg = 101.2;
    store.setNearParcels(sim, () => deg);
    expect(store.getState().bearings).toEqual([101]);
  });
  it("tracks outpost bearings and clears", () => {
    const store = createParcelsStore();
    store.setOutpostBearing("Boreal", -10);
    expect(store.getState().outposts).toEqual({ Boreal: 350 });
    store.setOutpostBearing("Boreal", null);
    expect(store.getState().outposts).toEqual({});
    store.setNearParcels(fakeSim(0, SIX));
    store.clear();
    expect(store.getState().count).toBe(0);
  });
  it("wraps degrees and computes sphere bearings (north +Y)", () => {
    expect(normalizeDeg(-0.4)).toBe(0);
    expect(normalizeDeg(725)).toBe(5);
    const p = { x: 1, y: 0, z: 0 };
    expect(sphereBearingDeg(p, { x: 1, y: 1, z: 0 })).toBe(0); // toward the pole: north
    expect(sphereBearingDeg(p, { x: 1, y: -1, z: 0 })).toBe(180);
    expect(sphereBearingDeg(p, { x: 1, y: 0, z: -1 })).toBe(90); // east
    expect(sphereBearingDeg(p, { x: 1, y: 0, z: 1 })).toBe(270);
    expect(sphereBearingDeg({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 })).toBeNull(); // pole
  });
});

describe("Near Parcels on the compass", () => {
  it("renders nothing with no parcels", () => {
    expect(render(createParcelsStore())).not.toContain("hud-parcels");
  });
  it("shows the count chip with pips (shape cues), the reward in the label and track markers", () => {
    const store = createParcelsStore();
    store.setNearParcels(fakeSim(0b11, SIX), bearingOfX, 30);
    store.setOutpostBearing("Boreal", 200);
    const html = render(store);
    expect(html).toContain("Parcels 2/6");
    expect(html).toContain("Near Parcels: 2 of 6 collected, 30 Lumens each");
    expect(html.match(/data-done="true"/g)).toHaveLength(2);
    expect(html.match(/data-done="false"/g)).toHaveLength(4);
    expect(html).toContain('title="Near Parcel"');
    expect(html).toContain('title="Outpost Boreal"');
    expect(html).not.toMatch(/>nearParcel|>parcels?[A-Z]/); // never raw ids
  });
  it("marks a completed set", () => {
    const store = createParcelsStore();
    store.setNearParcels(fakeSim(0b111111, SIX), bearingOfX);
    expect(render(store)).toContain('data-complete="true"');
  });
  it("store file has no rAF, timers, window listeners or three.js", () => {
    const src = readFileSync(fileURLToPath(new URL("./parcels-store.tsx", import.meta.url)), "utf8");
    expect(src).not.toMatch(/requestAnimationFrame|setInterval|setTimeout|addEventListener|from "three"/);
  });
});
