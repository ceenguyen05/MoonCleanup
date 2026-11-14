import { describe, expect, it } from "vitest";

import { seededRandom } from "./analysis.js";
import { decodeHeightCube, decodeHorizon, encodeHeightCube, encodeHorizon } from "./codec.js";

describe("terrain containers", () => {
  it("round-trips a height cube with wrap-around deltas", () => {
    const faceSize = 8;
    const p = faceSize + 2;
    const rand = seededRandom(3);
    const data = new Uint16Array(6 * p * p);
    for (let i = 0; i < data.length; i++) data[i] = Math.floor(rand() * 65536);
    const enc = encodeHeightCube({ faceSize, gutter: 1, offsetM: -12.5, scaleM: 0.0021, data });
    const dec = decodeHeightCube(enc.bytes);
    expect(dec.faceSize).toBe(faceSize);
    expect(dec.offsetM).toBe(-12.5);
    expect(dec.scaleM).toBe(0.0021);
    expect(Array.from(dec.data)).toEqual(Array.from(data));
  });

  it("is deterministic byte for byte", () => {
    const data = new Uint16Array(6 * 100).map((_, i) => (i * 37) & 0xffff);
    const a = encodeHeightCube({ faceSize: 8, gutter: 1, offsetM: 0, scaleM: 1, data });
    const b = encodeHeightCube({ faceSize: 8, gutter: 1, offsetM: 0, scaleM: 1, data });
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  });

  it("round-trips a horizon map", () => {
    const n = 8;
    const planes = new Uint8Array(6 * 8 * n * n).map((_, i) => (i * 13) & 255);
    const enc = encodeHorizon({
      faceSize: n,
      azimuths: 8,
      minAngleDeg: -16,
      maxAngleDeg: 60,
      minOccluderM: 20,
      planes,
    });
    const dec = decodeHorizon(enc.bytes);
    expect(dec.minAngleDeg).toBe(-16);
    expect(Array.from(dec.planes)).toEqual(Array.from(planes));
  });
});
