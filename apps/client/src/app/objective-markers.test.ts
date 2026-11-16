import { describe, expect, test } from "vitest";
import { sphereBearingDeg } from "../ui/hud/parcels-store";
import { ObjectiveMarkers, markerSink, type MarkerStation } from "./objective-markers";
import type { ParcelReadoutSource } from "./parcel-feed";
import { createUiStore } from "./ui-store";

const EAST = { x: 1, y: 0, z: 0 };

function source(): ParcelReadoutSource {
  const parcels = [
    { x: 0, y: 0, z: 1, done: false },
    { x: 0, y: 0, z: -1, done: true },
  ];
  return {
    nearParcelCount: parcels.length,
    nearParcel: (k, out) => {
      Object.assign(out, parcels[k]);
      return parcels[k]!.done;
    },
    outpostCount: 1,
    outpost: (_k, out) => {
      Object.assign(out, { id: "Boreal", ...EAST });
      return true;
    },
  };
}

function rig(step: { current: string | null }) {
  const store = createUiStore(1000);
  const calls: [string, number | null][] = [];
  const stations: MarkerStation[] = [{ kind: "assay_counter", x: 0, y: 1, z: 0 }];
  const markers = new ObjectiveMarkers({
    store,
    setMarkerBearing: (id, deg) => void calls.push([id, deg]),
    step: () => step.current,
    source,
    stations: () => stations,
    // Standing at the south-ish point (0,-1,0)... use +X axis offset so bearings are defined.
    samplePos: (out) => {
      Object.assign(out, { x: 0, y: 0.0001, z: 0.9999 });
      return true;
    },
    bearing: sphereBearingDeg,
  });
  return { store, calls, markers };
}

describe("ObjectiveMarkers", () => {
  test("active step sets compass.objectiveMarkerId and a bearing, changes clear the old marker, no step clears it", () => {
    const step = { current: "onboarding.first_stroke" as string | null };
    const { store, calls, markers } = rig(step);
    markers.pump(0);
    store.flush(0);
    expect(store.getState().compass.objectiveMarkerId).toBe("landing_apron");
    expect(calls[0]?.[0]).toBe("landing_apron");
    expect(typeof calls[0]?.[1]).toBe("number");

    step.current = "onboarding.find_near_parcel";
    markers.pump(1000);
    store.flush(1000);
    expect(store.getState().compass.objectiveMarkerId).toBe("near_parcel");
    expect(calls).toContainEqual(["landing_apron", null]);
    expect(calls[calls.length - 1]?.[0]).toBe("near_parcel");
    expect(typeof calls[calls.length - 1]?.[1]).toBe("number");

    step.current = null;
    markers.pump(2000);
    store.flush(2000);
    expect(store.getState().compass.objectiveMarkerId).toBeNull();
    expect(calls[calls.length - 1]).toEqual(["near_parcel", null]);
  });

  test("steps without a place show no marker; pump is throttled to 10 Hz", () => {
    const step = { current: "onboarding.fill_cell" as string | null };
    const { store, calls, markers } = rig(step);
    markers.pump(0);
    store.flush(0);
    expect(store.getState().compass.objectiveMarkerId).toBeNull();
    expect(calls).toEqual([]);
    step.current = "onboarding.pour_at_counter";
    markers.pump(50); // inside the 100 ms window: ignored
    expect(calls).toEqual([]);
    markers.pump(150);
    expect(calls[0]?.[0]).toBe("assay_counter");
  });

  test("markerSink forwards to a UI module that has setMarkerBearing and warns once when it does not", () => {
    const got: unknown[] = [];
    markerSink({ setMarkerBearing: (id: string, deg: number | null) => got.push([id, deg]) }, () => undefined)("a", 5);
    expect(got).toEqual([["a", 5]]);
    const warnings: string[] = [];
    const sink = markerSink({}, (m) => warnings.push(m));
    sink("a", 1);
    sink("a", 2);
    expect(warnings).toHaveLength(1);
  });
});
