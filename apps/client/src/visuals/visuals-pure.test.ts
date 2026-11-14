import { describe, expect, it } from "vitest";
import { cascadeEndsM } from "./lighting/cascade-splits";
import {
  EV100,
  createKeyState,
  earthExposureGain,
  earthPhaseFactor,
  litFraction,
  preExposureScale,
  resolveKey,
  sunEv100,
  sunFlatLux,
} from "./lighting/key-light";
import { K_DEPTH_TEXELS, K_NORMAL_TEXELS, depthBias, normalBiasM } from "./lighting/shadow-bias";
import { labBStar, maxLumaStep, meanPatch } from "./lookdev/analysis";
import { directionFromAzEl, pixelsForAngle, sphereRadiusForAngle } from "./sky/sky-math";
import { generateStars, limitingMagnitude, starRadiusPx } from "./sky/star-catalog";

describe("key light", () => {
  it("derives the noon x = 1.753 * albedo of art-direction 2.3", () => {
    const e = sunFlatLux(60) * 1.15;
    const x = (e / Math.PI) * preExposureScale(EV100.noon);
    expect(x).toBeGreaterThan(1.74);
    expect(x).toBeLessThan(1.76);
  });

  it("scripts the exposure from the key elevation", () => {
    expect(sunEv100(1)).toBe(EV100.dawn);
    expect(sunEv100(30)).toBeCloseTo(EV100.morning, 6);
    expect(sunEv100(75)).toBe(EV100.noon);
  });

  it("hands the key to the Earth at near-side night and to the floor on the far side", () => {
    const k = createKeyState();
    expect(resolveKey(30, 10, 1, k).mode).toBe("sun");
    expect(resolveKey(-10, 30, 1, k)).toMatchObject({ mode: "earth", earthLux: 300, ev100: EV100.nightNear });
    expect(resolveKey(-10, -20, 1, k)).toMatchObject({ mode: "floor", ev100: EV100.nightFar });
  });

  it("maps the lit fraction to the earthshine table", () => {
    expect(earthPhaseFactor(1)).toBe(1);
    expect(earthPhaseFactor(0.5)).toBeCloseTo(0.3, 6);
    expect(earthPhaseFactor(0)).toBe(0);
  });

  it("lights a full Earth when the sun is behind the viewer's opposite side", () => {
    // Earth straight ahead (+z), sun straight behind the viewer (-z): the Earth's visible face is lit.
    expect(litFraction(0, 0, -1, 0, 0, 1)).toBeCloseTo(1, 6);
    expect(litFraction(0, 0, 1, 0, 0, 1)).toBeCloseTo(0, 6);
  });

  it("caps the Earth's display luminance at night", () => {
    const night = preExposureScale(EV100.nightNear);
    expect(((0.3 * 133_800) / Math.PI) * earthExposureGain(night)).toBeLessThanOrEqual(0.9001);
  });
});

describe("sun shadow bias", () => {
  it("offsets the lookup by a fixed number of texels of the cascade", () => {
    expect(normalBiasM(0.023)).toBeCloseTo(K_NORMAL_TEXELS * 0.023, 9);
    expect(normalBiasM(0.276) / normalBiasM(0.023)).toBeCloseTo(12, 6);
  });

  it("keeps the offset below a 0.3 m rock in the two near cascades of Medium at any sun elevation", () => {
    // M0-visual-checks: the old 1 / sin(elevation) factor lifted the lookup 0.36 m at 4 degrees and the rock lost its shadow.
    for (const texel of [0.023, 0.097]) expect(normalBiasM(texel)).toBeLessThan(0.15);
  });

  it("biases the depth by half a texel toward more shadow, in the cascade's normalised depth", () => {
    // Positive = more shadow in three; a negative value opened 9 to 24 cm contact gaps in the M0 check.
    expect(depthBias(0.023, 529.5)).toBeCloseTo((K_DEPTH_TEXELS * 0.023) / 529.5, 12);
    expect(depthBias(0.023, 529.5)).toBeGreaterThan(0);
    expect(depthBias(0.023, 0)).toBe(0);
  });
});

describe("cascade splits", () => {
  it("ends at the far plane and starts at the preset split", () => {
    const ends = cascadeEndsM(3, 10, 120, 0.75);
    expect(ends[0]).toBe(10);
    expect(ends[2]).toBe(120);
    expect(ends[1]).toBeGreaterThan(10);
  });
});

describe("star catalogue", () => {
  const stars = generateStars();
  it("is deterministic and has the naked-eye count", () => {
    expect(stars.count).toBe(8298);
    expect(generateStars().dirs[17]).toBe(stars.dirs[17]);
  });
  it("keeps unit directions and magnitudes in range", () => {
    for (let i = 0; i < stars.count; i += 97) {
      const l = Math.hypot(stars.dirs[i * 3] ?? 0, stars.dirs[i * 3 + 1] ?? 0, stars.dirs[i * 3 + 2] ?? 0);
      expect(l).toBeCloseTo(1, 4);
      expect(stars.mag[i]).toBeGreaterThanOrEqual(-1.6);
      expect(stars.mag[i]).toBeLessThanOrEqual(6.55);
    }
  });
  it("follows the limiting-magnitude model and the 1.2 px radius floor", () => {
    expect(limitingMagnitude(EV100.nightNear)).toBeCloseTo(6.5, 6);
    expect(limitingMagnitude(EV100.noon)).toBeCloseTo(2.5, 1);
    expect(starRadiusPx(6.5)).toBeGreaterThanOrEqual(1.2);
  });
});

describe("sky maths", () => {
  it("places azimuth 0 on +x and 90 on +z", () => {
    const d = { x: 0, y: 0, z: 0 };
    directionFromAzEl(0, 0, d);
    expect(d.x).toBeCloseTo(1, 6);
    directionFromAzEl(90, 0, d);
    expect(d.z).toBeCloseTo(1, 6);
  });
  it("sizes the Earth: 2.4 degrees is about 39 px at 1080p and vFOV 60", () => {
    expect(pixelsForAngle(2.4, 60, 1080)).toBeGreaterThan(37);
    expect(pixelsForAngle(2.4, 60, 1080)).toBeLessThan(41);
    expect(sphereRadiusForAngle(2.4, 1000)).toBeCloseTo(20.94, 1);
  });
});

describe("patch analysis", () => {
  it("averages a patch and reports luma and b*", () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < 16; i++) rgba.set([200, 100, 50, 255], i * 4);
    const s = meanPatch(rgba, 4, 4, { x: 0, y: 0, w: 4, h: 4 });
    expect(s.luma).toBeCloseTo(0.2126 * 200 + 0.7152 * 100 + 0.0722 * 50, 4);
    expect(s.labB).toBeGreaterThan(20);
    expect(labBStar(128, 128, 128)).toBeCloseTo(0, 0);
  });
  it("finds the largest luma step between neighbouring patches", () => {
    const rgba = new Uint8ClampedArray(8 * 2 * 4);
    for (let x = 0; x < 8; x++)
      for (let y = 0; y < 2; y++) rgba.set(x < 4 ? [100, 100, 100, 255] : [112, 112, 112, 255], (y * 8 + x) * 4);
    expect(maxLumaStep(rgba, 8, 2, { x: 0, y: 0, w: 8, h: 2 }, 4)).toBeCloseTo(12, 4);
  });
});
