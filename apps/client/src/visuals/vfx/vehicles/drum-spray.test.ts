import { describe, expect, test } from "vitest";
import { GRAIN_G, GrainPool } from "../grains";
import { DRUM_BURST, DRUM_SPACING_M, DrumSpray } from "./drum-spray";

describe("Trundle brush-drum spray", () => {
  test("no grains while the intake is idle or the vehicle is stopped", () => {
    const pool = new GrainPool(256, 3);
    const spray = new DrumSpray();
    expect(spray.step(pool, 1, 3, 0, 0, 0, 0, 1, 0, 0)).toBe(0);
    expect(spray.step(pool, 1, 0, 1, 0, 0, 0, 1, 0, 0)).toBe(0);
    expect(pool.emitted).toBe(0);
  });

  test("cadence follows rolled distance, bounded per call", () => {
    const pool = new GrainPool(1024, 3);
    const spray = new DrumSpray();
    let bursts = 0;
    for (let i = 0; i < 60; i++) bursts += spray.step(pool, 1 / 60, 3, 1, 0, 0, 0, 1, 0, 0);
    expect(Math.abs(bursts - 3 / DRUM_SPACING_M)).toBeLessThanOrEqual(1); // float carry may hold the last one back
    expect(pool.emitted).toBe(bursts * DRUM_BURST.count);
    const long = spray.step(pool, 5, 3, 1, 0, 0, 0, 1, 0, 0);
    expect(long).toBeLessThanOrEqual(3);
  });

  test("grains are ballistic: thrown forward-up at bounded speed, down by g, landing on the ground", () => {
    const pool = new GrainPool(64, 9);
    new DrumSpray().step(pool, 1, 3, 1, 0, 0.2, 0, 0, 1, 0); // heading +z
    const out = new Float64Array(3);
    const maxV = DRUM_BURST.speedMax;
    let forward = 0;
    for (let i = 0; i < pool.emitted; i++) {
      const k = i * 4;
      expect(Math.hypot(pool.v0[k]!, pool.v0[k + 1]!, pool.v0[k + 2]!)).toBeLessThanOrEqual(maxV + 1e-9);
      expect(pool.v0[k + 1]!).toBeGreaterThan(0);
      if (pool.v0[k + 2]! > 0) forward++;
      const land = pool.v0[k + 3]!;
      expect(pool.sample(i, pool.time + land * 0.999, out)).toBe(true);
      expect(out[1]!).toBeGreaterThan(-0.02);
      // apex height follows y = y0 + vy t - g t^2 / 2 for the closed form
      expect(GRAIN_G).toBeCloseTo(1.62, 6);
    }
    expect(forward).toBe(pool.emitted); // spread 0.7 rad about +z
  });
});
