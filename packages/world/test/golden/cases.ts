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
import { computeLedgerVectors } from "./ledger-lane";
import ledgerV1 from "../vectors/ledger-v1.json";

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

  test(`[${lane}] dust ledger vectors V1 (WDS 4.5b): texel SHA-256, totals, per-actor units, saved chunk bytes`, () => {
    const got = computeLedgerVectors();
    expect(got.plots.length).toBeGreaterThanOrEqual(20);
    expect(got.restoredWorldHash).toBe(got.worldHash);
    expect(got).toEqual(ledgerV1);
  });

  test(`[${lane}] H_base + H_detail agrees with the Node recording`, () => {
    const got = seededGroundHeights();
    expect(got.length).toBe(GOLDEN_GROUND_HEIGHTS.length);
    got.forEach((h, k) =>
      expect(Math.abs(h - (GOLDEN_GROUND_HEIGHTS[k] ?? NaN))).toBeLessThan(HEIGHT_ENGINE_TOLERANCE_M),
    );
  });
}
