import { describe, expect, it } from "vitest";
import { agxToneMap, displayLuma, neutralAlbedoLuma, srgbEncode } from "./agx";
import { DETAIL_GRAD_RANGE, generateDetailTile } from "./detail-texture";
import {
  ALBEDO_CLEAN,
  ALBEDO_GRIME,
  CHART_PATCHES,
  CHART_TOLERANCE_LUMA,
  CLEAN_TINT,
  GRIME_TINT,
} from "./regolith-constants";
import { createMaskBuffer, packMaskRgba8, sampleGrime, stampStroke, type MaskWorldRect } from "./stroke-mask";

const NOON_LUX = 133_800 * Math.sin((60 * Math.PI) / 180);
const NOON_EV = 14.3;

describe("agx CPU port (art-direction 2.3 derivation)", () => {
  it("is monotonic and maps grey to grey", () => {
    const out = [0, 0, 0];
    const lumas: number[] = [];
    for (const v of [0.001, 0.01, 0.05, 0.18, 0.5, 1, 4, 16]) {
      agxToneMap(v, v, v, out);
      expect(Math.abs((out[0] ?? 0) - (out[1] ?? 0))).toBeLessThan(0.02);
      lumas.push(displayLuma(v, v, v));
    }
    for (let i = 1; i < lumas.length; i++) expect(lumas[i] ?? 0).toBeGreaterThan(lumas[i - 1] ?? 0);
    // Same three numbers as the M0-W2-T07 row 6 AgX run on the GPU (display bytes of 0.05 / 0.18 / 1 / 4 / 16).
    expect(displayLuma(0.05, 0.05, 0.05)).toBeCloseTo(70, -1);
    expect(displayLuma(1, 1, 1)).toBeGreaterThan(195);
    expect(srgbEncode(0.5)).toBeCloseTo(0.735, 2);
  });

  it("predicts the chart of VT-M0-06 (126 / 181 / 213 +-8) at the noon key with the 15 % fill", () => {
    for (const patch of CHART_PATCHES) {
      const luma = neutralAlbedoLuma(patch.albedo, NOON_LUX, 0.15, NOON_EV);
      expect(Math.abs(luma - patch.expectedLuma)).toBeLessThanOrEqual(CHART_TOLERANCE_LUMA);
    }
  });

  it("predicts grime 119 and clean 182: ratio >= 1.45 and >= 50 codes (VT-M0-08)", () => {
    const grime = neutralAlbedoLuma(ALBEDO_GRIME, NOON_LUX, 0.15, NOON_EV);
    const clean = neutralAlbedoLuma(ALBEDO_CLEAN, NOON_LUX, 0.15, NOON_EV);
    expect(Math.abs(grime - 119)).toBeLessThanOrEqual(CHART_TOLERANCE_LUMA);
    expect(Math.abs(clean - 182)).toBeLessThanOrEqual(CHART_TOLERANCE_LUMA);
    expect(clean / grime).toBeGreaterThanOrEqual(1.45);
    expect(clean - grime).toBeGreaterThanOrEqual(50);
  });

  it("keeps the tinted clean and grime colours at their calibrated luma", () => {
    for (const tint of [GRIME_TINT, CLEAN_TINT]) {
      const luma = 0.2126 * tint[0] + 0.7152 * tint[1] + 0.0722 * tint[2];
      expect(luma).toBeCloseTo(1, 6);
    }
    expect(GRIME_TINT[0]).toBeGreaterThan(GRIME_TINT[2]); // warm
  });
});

describe("detail tile", () => {
  const tile = generateDetailTile(128, 99);
  it("is deterministic, in range and tileable", () => {
    expect(generateDetailTile(128, 99).data).toEqual(tile.data);
    expect(tile.maxGradient).toBeLessThan(DETAIL_GRAD_RANGE);
    const { size, data } = tile;
    // The wrap-around step between the last and the first column is no larger than the steps inside the tile.
    let inside = 0;
    let seam = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size - 1; x++)
        inside = Math.max(inside, Math.abs((data[(y * size + x + 1) * 4] ?? 0) - (data[(y * size + x) * 4] ?? 0)));
      seam = Math.max(seam, Math.abs((data[y * size * 4] ?? 0) - (data[(y * size + size - 1) * 4] ?? 0)));
    }
    expect(seam).toBeLessThanOrEqual(inside);
  });
});

describe("stroke mask", () => {
  const rect: MaskWorldRect = { originX: -2, originZ: -2, sizeX: 4, sizeZ: 4 };
  const res = 512; // 0.78 cm texels
  const buffer = createMaskBuffer(res, res, rect);
  stampStroke(buffer, { x0: 0, z0: -0.5, x1: 0, z1: 0.5, widthM: 0.15 });

  it("clears the brush footprint and keeps dust outside", () => {
    expect(sampleGrime(buffer, 0, 0)).toBeCloseTo(0, 2);
    expect(sampleGrime(buffer, 0.3, 0)).toBeCloseTo(1, 2);
    expect(sampleGrime(buffer, 0, 0.7)).toBeCloseTo(1, 2);
    // Squared ends: just inside the end of the brush is still clean.
    expect(sampleGrime(buffer, 0, 0.55)).toBeLessThan(0.1);
  });

  it("makes an edge of at most 2 cm (10-90 %) with the texel floor of the mask", () => {
    const xs: number[] = [];
    for (let x = 0.03; x < 0.15; x += 0.001) xs.push(x);
    const x10 = xs.find((x) => sampleGrime(buffer, x, 0) >= 0.1);
    const x90 = xs.find((x) => sampleGrime(buffer, x, 0) >= 0.9);
    expect(x10).toBeDefined();
    expect(x90).toBeDefined();
    expect((x90 ?? 0) - (x10 ?? 0)).toBeLessThanOrEqual(0.02);
  });

  it("pushes a berm on the dusty side only, 1.5-3 cm high", () => {
    const bytes = packMaskRgba8(buffer);
    const at = (x: number, z: number): [number, number] => {
      const i = Math.floor(((x - rect.originX) / rect.sizeX) * res);
      const j = Math.floor(((z - rect.originZ) / rect.sizeZ) * res);
      return [bytes[(j * res + i) * 4] ?? 0, bytes[(j * res + i) * 4 + 1] ?? 0];
    };
    expect(at(0, 0)[1]).toBe(0); // no berm in the clean footprint
    let peak = 0;
    for (let x = 0.075; x < 0.25; x += 0.002) peak = Math.max(peak, at(x, 0)[1]);
    const peakM = (peak / 255) * 0.08;
    expect(peakM).toBeGreaterThan(0.015);
    expect(peakM).toBeLessThan(0.03);
    expect(at(1.5, 1.5)).toEqual([255, 0]);
  });

  it("re-sweeping removes the berm of an earlier pass", () => {
    const two = createMaskBuffer(res, res, rect);
    stampStroke(two, { x0: 0, z0: -0.5, x1: 0, z1: 0.5, widthM: 0.15 });
    stampStroke(two, { x0: 0.1, z0: -0.5, x1: 0.1, z1: 0.5, widthM: 0.15 });
    const bytes = packMaskRgba8(two);
    const i = Math.floor(((0.1 + 0.01 - rect.originX) / rect.sizeX) * res);
    const j = Math.floor(((0 - rect.originZ) / rect.sizeZ) * res);
    expect(bytes[(j * res + i) * 4 + 1]).toBe(0);
    expect(sampleGrime(two, 0.1, 0)).toBeCloseTo(0, 2);
    // The overlap is clean, the outer side of the second pass is dusty again.
    expect(sampleGrime(two, 0.3, 0)).toBeCloseTo(1, 2);
  });
});
