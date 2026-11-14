import { describe, expect, it } from "vitest";
import { encodePng, makeImage } from "./image";
import {
  edgeWidth1090,
  labB,
  lumaPatch,
  nonBlackFraction,
  pngDiskSize,
  sobelSharpness,
  starCount,
  temporalVariance,
} from "./measures";

const grey = (v: number) => [v, v, v] as const;

describe("measure synthetic charts (known chart in, known number out)", () => {
  it("lumaPatch: flat grey patches return their value", () => {
    const img = makeImage(40, 20, (x) => (x < 20 ? grey(50) : grey(200)));
    expect(lumaPatch(img, { x: 0, y: 0, w: 20, h: 20 }).value).toBeCloseTo(50, 1);
    expect(lumaPatch(img, { x: 20, y: 0, w: 20, h: 20 }).value).toBeCloseTo(200, 1);
    expect(lumaPatch(img, { x: 0, y: 0, w: 40, h: 20 }).value).toBeCloseTo(125, 1);
  });

  it("edgeWidth1090: hard step ~0.8 px, 10-px linear ramp 8 px, falling edge too", () => {
    const rect = { x: 0, y: 0, w: 40, h: 8 };
    const step = makeImage(40, 8, (x) => (x < 20 ? grey(0) : grey(255)));
    expect(edgeWidth1090(step, rect).value).toBeCloseTo(0.8, 1);
    const ramp = makeImage(40, 8, (x) => grey(Math.round(Math.max(0, Math.min(1, (x - 15) / 10)) * 255)));
    expect(edgeWidth1090(ramp, rect).value).toBeCloseTo(8, 0);
    const fall = makeImage(40, 8, (x) => grey(Math.round(Math.max(0, Math.min(1, (25 - x) / 10)) * 255)));
    expect(edgeWidth1090(fall, rect).value).toBeCloseTo(8, 0);
  });

  it("sobelSharpness: flat is 0, hard edge beats blurred edge, exact value for a step", () => {
    const rect = { x: 0, y: 0, w: 40, h: 40 };
    expect(
      sobelSharpness(
        makeImage(40, 40, () => grey(128)),
        rect,
      ).value,
    ).toBe(0);
    const hard = makeImage(40, 40, (x) => (x < 20 ? grey(0) : grey(255)));
    const soft = makeImage(40, 40, (x) => grey(Math.round(Math.max(0, Math.min(1, (x - 10) / 20)) * 255)));
    expect(sobelSharpness(hard, rect).value).toBeGreaterThan(sobelSharpness(soft, rect).value);
    // gx = 4 * 255 on two of 38 interior columns
    expect(sobelSharpness(hard, rect).value).toBeCloseTo(Math.sqrt((2 * 1020 ** 2) / 38), 3);
  });

  it("labB: neutral grey 0, yellow ~94.5, blue ~-108.3", () => {
    const r = { x: 0, y: 0, w: 4, h: 4 };
    expect(
      labB(
        makeImage(4, 4, () => grey(128)),
        r,
      ).value,
    ).toBeCloseTo(0, 1);
    expect(
      labB(
        makeImage(4, 4, () => [255, 255, 0]),
        r,
      ).value,
    ).toBeCloseTo(94.5, 0);
    expect(
      labB(
        makeImage(4, 4, () => [0, 0, 255]),
        r,
      ).value,
    ).toBeCloseTo(-108.3, 0);
  });

  it("pngDiskSize: equals encoded length; flat image smaller than noise", () => {
    const flat = encodePng(makeImage(64, 64, () => grey(10)));
    let s = 1;
    const noise = encodePng(
      makeImage(64, 64, () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return grey(s & 255);
      }),
    );
    expect(pngDiskSize(flat)).toBe(flat.length);
    expect(pngDiskSize(flat)).toBeLessThan(pngDiskSize(noise));
  });

  it("starCount: counts planted single-pixel stars, ignores a large disc unless maxArea raised", () => {
    const stars = [
      [5, 5],
      [20, 7],
      [33, 30],
      [10, 40],
      [48, 48],
    ];
    const img = makeImage(64, 64, (x, y) => {
      if (stars.some(([sx, sy]) => sx === x && sy === y)) return grey(255);
      if ((x - 50) ** 2 + (y - 12) ** 2 <= 36) return grey(255);
      return grey(0);
    });
    const all = { x: 0, y: 0, w: 64, h: 64 };
    expect(starCount(img, all).value).toBe(5);
    expect(starCount(img, all, { maxArea: 1000 }).value).toBe(6);
  });

  it("temporalVariance: identical frames 0; alternating 0/100 frames give 2500", () => {
    const a = makeImage(8, 8, () => grey(0));
    const b = makeImage(8, 8, () => grey(100));
    expect(temporalVariance([a, a, a]).value).toBe(0);
    expect(temporalVariance([a, b, a, b]).value).toBeCloseTo(2500, 3);
  });

  it("nonBlackFraction", () => {
    expect(nonBlackFraction(makeImage(10, 10, () => grey(0)))).toBe(0);
    expect(nonBlackFraction(makeImage(10, 10, (x) => (x < 5 ? grey(0) : grey(200))))).toBe(0.5);
  });
});
