// The golden assertions, registered identically by the Node and the browser lane.
import { expect, test } from "vitest";
import {
  fixtureHeightMaxError,
  GOLDEN_GROUND_HEIGHTS,
  GOLDEN_MOONLET,
  GOLDEN_STANDARD,
  HEIGHT_ENGINE_TOLERANCE_M,
  moonletDigests,
  seededGroundHeights,
  standardDigests,
} from "./lane";

export function registerGoldenCases(lane: string): void {
  test(`[${lane}] GP(128,0) grid, point->plot and neighbour digests`, () => {
    expect(standardDigests()).toEqual(GOLDEN_STANDARD);
  });

  test(`[${lane}] GP(64,0) Moonlet digests`, () => {
    expect(moonletDigests()).toEqual(GOLDEN_MOONLET);
  });

  test(`[${lane}] H_base matches the bake's golden samples (0.02 m)`, () => {
    expect(fixtureHeightMaxError()).toBeLessThanOrEqual(0.02);
  });

  test(`[${lane}] H_base + H_detail agrees with the Node recording`, () => {
    const got = seededGroundHeights();
    expect(got.length).toBe(GOLDEN_GROUND_HEIGHTS.length);
    got.forEach((h, k) =>
      expect(Math.abs(h - (GOLDEN_GROUND_HEIGHTS[k] ?? NaN))).toBeLessThan(HEIGHT_ENGINE_TOLERANCE_M),
    );
  });
}
