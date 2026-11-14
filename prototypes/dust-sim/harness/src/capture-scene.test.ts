import { describe, expect, it } from "vitest";
import { captureSceneSpec, pixelFootprintM, shadeLinear, sunDirection } from "./capture-scene";
import {
  cmToPx,
  coverageAtLeast,
  edgeWidthCm,
  edgeWidthPx,
  judgeEdge,
  makeImage,
  meanAbsDiff,
  pearson,
  riseWidth10to90,
  sweepDissolveCorrelation,
} from "./image-compare";
import { makeBookmarks } from "./scene";

/** Synthetic vertical edge: value 0 left of `x0`, 1 right of `x0 + w`, linear ramp between. */
function ramp(width: number, height: number, x0: number, w: number) {
  const img = makeImage(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      img.data[y * width + x] = w === 0 ? (x + 0.5 >= x0 ? 1 : 0) : Math.min(1, Math.max(0, (x + 0.5 - x0) / w));
    }
  }
  return img;
}

describe("capture scene", () => {
  it("is deterministic JSON with 9 bookmarks and unit sun vectors", () => {
    const a = JSON.stringify(captureSceneSpec());
    expect(JSON.stringify(captureSceneSpec())).toBe(a);
    const spec = captureSceneSpec();
    expect(spec.bookmarks).toHaveLength(makeBookmarks().length);
    for (const b of spec.bookmarks) expect(Math.hypot(...b.sunDir)).toBeCloseTo(1, 9);
  });

  it("sun elevation matches the pose and shading darkens with dust", () => {
    const p = makeBookmarks()[0]!.pose;
    const s = sunDirection(p);
    const sinEl = s[0] * p.up[0] + s[1] * p.up[1] + s[2] * p.up[2];
    expect(Math.asin(sinEl) * (180 / Math.PI)).toBeCloseTo(p.sunElevationDeg, 6);
    expect(shadeLinear(p, 1)).toBeLessThan(shadeLinear(p, 0));
  });

  it("pixel footprint at 2 m is about 2.14 mm at 1080p vFOV 60", () => {
    expect(pixelFootprintM(2) * 1000).toBeCloseTo(2.138, 2);
  });
});

describe("edge width", () => {
  it("a linear ramp of w px has 10-90 width 0.8 w", () => {
    for (const w of [5, 10, 20]) {
      expect(edgeWidthPx(ramp(200, 8, 90, w), { axis: "x" })).toBeCloseTo(0.8 * w, 1);
    }
  });

  it("a hard step reads about 0.8 px or less, passing the 2 px bar", () => {
    const px = edgeWidthPx(ramp(100, 4, 50, 0), { axis: "x" });
    expect(px).not.toBeNull();
    expect(px!).toBeLessThanOrEqual(1);
    expect(judgeEdge(px, 2).passWds).toBe(true);
  });

  it("is orientation independent and ignores a flat image", () => {
    const img = ramp(120, 6, 60, 10);
    const t = makeImage(6, 120);
    for (let y = 0; y < 120; y++) for (let x = 0; x < 6; x++) t.data[y * 6 + x] = img.data[x * 120 + y]!;
    expect(edgeWidthPx(t, { axis: "y" })).toBeCloseTo(edgeWidthPx(img, { axis: "x" })!, 6);
    expect(edgeWidthPx(makeImage(50, 5, 0.5), { axis: "x" })).toBeNull();
    expect(riseWidth10to90([0, 1])).toBeNull();
  });

  it("converts between px and world cm, and flags a wide dissolve", () => {
    const cm = edgeWidthCm(10, 2);
    expect(cmToPx(cm, 2)).toBeCloseTo(10, 6);
    const v = judgeEdge(20.6, 2); // the model P1 ring ramp at 2 m
    expect(v.passWds).toBe(false);
    expect(v.passVisualTarget).toBe(false);
  });
});

describe("coverage and correlation", () => {
  it("counts coverage in a rect", () => {
    const img = ramp(100, 10, 50, 0);
    expect(coverageAtLeast(img, 0.5)).toBeCloseTo(0.5, 6);
    expect(coverageAtLeast(img, 0.5, { x0: 0, y0: 0, x1: 40, y1: 10 })).toBe(0);
  });

  it("mean abs diff and pearson basics", () => {
    const a = ramp(50, 5, 25, 10);
    expect(meanAbsDiff(a, a)).toBe(0);
    expect(pearson(a, a)).toBeCloseTo(1, 9);
    const inv = makeImage(50, 5);
    for (let i = 0; i < inv.data.length; i++) inv.data[i] = 1 - a.data[i]!;
    expect(pearson(a, inv)).toBeCloseTo(-1, 9);
    expect(() => meanAbsDiff(a, makeImage(10, 5))).toThrow();
  });

  it("sweep correlation: dissolve following the sweep scores high, a shifted one low", () => {
    const sweeps = [{ x0: 40, y0: 20, x1: 40, y1: 80, widthPx: 20 }];
    const good = makeImage(100, 100);
    const shifted = makeImage(100, 100);
    for (let y = 10; y < 90; y++) {
      for (let x = 0; x < 100; x++) {
        if (Math.abs(x + 0.5 - 40) <= 10) good.data[y * 100 + x] = 1;
        if (Math.abs(x + 0.5 - 80) <= 10) shifted.data[y * 100 + x] = 1;
      }
    }
    expect(sweepDissolveCorrelation(good, sweeps)).toBeGreaterThan(0.95);
    expect(sweepDissolveCorrelation(shifted, sweeps)).toBeLessThan(0);
  });
});
