// ShiftState Schema v1.1: `nearParcelsCollected` round-trips through the Colyseus wire (full state and patch) the way a
// client decodes it (Schema reflection, no client-side classes), and `nearParcelsMask` builds the bitmask.

import { Encoder, Reflection, type Schema } from "@colyseus/schema";
import { describe, expect, it } from "vitest";
import { ShiftStateSchemaClass, nearParcelsMask, type NearParcelSource } from "./shift-state";

function fakeSim(collected: readonly boolean[]): NearParcelSource {
  return {
    nearParcelCount: collected.length,
    nearParcel: (k, out) => {
      out.x = k;
      out.y = 0;
      out.z = 0;
      return collected[k] === true;
    },
  };
}

describe("nearParcelsMask", () => {
  it("sets bit k for each collected parcel", () => {
    expect(nearParcelsMask(fakeSim([]))).toBe(0);
    expect(nearParcelsMask(fakeSim([false, false, false, false, false, false]))).toBe(0);
    expect(nearParcelsMask(fakeSim([true, false, true, false, false, true]))).toBe(0b10_0101);
    expect(nearParcelsMask(fakeSim([true, true, true, true, true, true]))).toBe(0b11_1111);
  });

  it("caps at 8 parcels so the value always fits uint8", () => {
    expect(nearParcelsMask(fakeSim(Array.from({ length: 10 }, () => true)))).toBe(0xff);
  });
});

describe("ShiftState Schema nearParcelsCollected (v1.1)", () => {
  it("round-trips via reflection decoding on full state and on a patch", () => {
    const state = new ShiftStateSchemaClass();
    state.contractId = "c";
    state.nearParcelsCollected = 0b00_0001;
    const encoder = new Encoder(state);
    const decoder = Reflection.decode(Reflection.encode(encoder));
    decoder.decode(encoder.encodeAll());
    const view = decoder.state as Schema & { nearParcelsCollected?: number; contractId?: string };
    expect(view.contractId).toBe("c");
    expect(view.nearParcelsCollected).toBe(1);

    state.nearParcelsCollected = 0b10_1001;
    decoder.decode(encoder.encode());
    encoder.discardChanges();
    expect(view.nearParcelsCollected).toBe(0b10_1001);

    // Late joiner: a fresh full-state decode sees the current mask.
    const late = Reflection.decode(Reflection.encode(encoder));
    late.decode(encoder.encodeAll());
    expect((late.state as Schema & { nearParcelsCollected?: number }).nearParcelsCollected).toBe(0b10_1001);
  });
});
