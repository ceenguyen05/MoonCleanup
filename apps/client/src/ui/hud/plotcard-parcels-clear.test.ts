import { describe, expect, it, vi } from "vitest";
import { STANDARD_GRID_PARAMS } from "@moon-cleanup/shared";
import { createParcelsStore, type ParcelDir } from "./parcels-store";
import { plotLabel, resolvePlotLabel } from "./plot-label";
import { DEFAULT_BINDINGS } from "../../gameplay";
import { assignInput, inputsFor } from "../menus/controls-model";

const six = {
  nearParcelCount: 6,
  nearParcel(k: number, out: ParcelDir): boolean {
    out.x = k;
    out.y = 0;
    out.z = 1;
    return k < 2;
  },
};

describe("plot label", () => {
  it("derives chunk-local ids and passes real labels through", () => {
    expect(plotLabel(0)).toBe("0-0");
    // plot (diamond 0, i=17, j=33): chunk (1*8+2)=10, local (1*16+1)=17
    expect(plotLabel(17 * 128 + 33)).toBe("10-17");
    expect(plotLabel(STANDARD_GRID_PARAMS.northPolePlotId)).toBe(`${STANDARD_GRID_PARAMS.poleChunkId}-0`);
    expect(resolvePlotLabel("4100", 4100)).toBe(plotLabel(4100));
    expect(resolvePlotLabel("41-207", 4100)).toBe("41-207");
    expect(resolvePlotLabel("", null)).toBe("");
  });
});

describe("clearNearParcels", () => {
  it("clears parcels, keeps outposts, notifies once and is a no-op when empty", () => {
    const store = createParcelsStore();
    store.setNearParcels(six, (d) => d.x * 10);
    store.setOutpostBearing("outpost.a", 90);
    expect(store.getState().count).toBe(6);
    const listener = vi.fn();
    store.subscribe(listener);
    store.clearNearParcels();
    const s = store.getState();
    expect([s.count, s.collected, s.collectedMask, s.bearings.length]).toEqual([0, 0, 0, 0]);
    expect(s.outposts["outpost.a"]).toBe(90);
    expect(listener).toHaveBeenCalledTimes(1);
    store.clearNearParcels();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("re-adopts a new parcel set after a clear (stale bearings do not suppress the publish)", () => {
    const store = createParcelsStore();
    store.setNearParcels(six, (d) => d.x * 10);
    store.clearNearParcels();
    store.setNearParcels(six, (d) => d.x * 10);
    expect(store.getState().bearings).toEqual([null, null, 20, 30, 40, 50]);
    expect(store.getState().collected).toBe(2);
  });
});

describe("Plot Card pad binding", () => {
  it("can be captured on a gamepad button through the existing rebinding model", () => {
    const table = assignInput(DEFAULT_BINDINGS as Record<string, string>, "plotCard", "pad", "Pad16").table;
    expect(inputsFor(table, "plotCard", "pad")).toEqual(["Pad16"]);
    expect(inputsFor(table, "plotCard", "key")).toEqual(["KeyC"]);
  });
});
