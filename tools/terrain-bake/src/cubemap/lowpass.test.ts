import { describe, expect, it } from "vitest";

import { boxWidthForSigma, lowpassEquirect } from "./lowpass.js";

describe("lowpass", () => {
  it("keeps a constant field constant", () => {
    const w = 72;
    const h = 36;
    const data = new Float32Array(w * h).fill(7);
    const out = lowpassEquirect(data, w, h, { sigmaM: 30_000, pixelMetresAtEquator: 5000 });
    for (const v of out) expect(v).toBeCloseTo(7, 4);
  });

  it("smooths a spike and spreads wider toward the poles", () => {
    const w = 360;
    const h = 180;
    const data = new Float32Array(w * h);
    data[90 * w + 100] = 1000;
    data[5 * w + 100] = 1000;
    const out = lowpassEquirect(data, w, h, { sigmaM: 30_000, pixelMetresAtEquator: 5000 });
    expect(out[90 * w + 100] ?? 0).toBeLessThan(200);
    const spreadEquator = out.slice(90 * w, 91 * w).filter((v) => v > 0.01).length;
    const spreadPole = out.slice(5 * w, 6 * w).filter((v) => v > 0.01).length;
    expect(spreadPole).toBeGreaterThan(spreadEquator);
  });

  it("gives an odd box width", () => {
    expect(boxWidthForSigma(15.83) % 2).toBe(1);
  });
});
