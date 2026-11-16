// M1-W3-T07 grains v0: ballistics (VT-M1-16 numeric hook), emission ranges, recycling and upload ranges.
import { describe, expect, it } from "vitest";
import { DESK_DUSTER_BURST, GRAIN_G, GRAIN_STRIDE, GrainPool, landingTime, VANISH_S } from "./grain-pool";

describe("grain pool", () => {
  it("landing time solves the parabola back to the ground", () => {
    expect(landingTime(0, 1.62, 0)).toBeCloseTo(2, 6);
    const t = landingTime(0.5, 1, 0);
    expect(0.5 + t - 0.5 * GRAIN_G * t * t).toBeCloseTo(0, 6);
  });

  it("sample() follows x(t) = p0 + v0 t + g t^2 / 2 with no drag, and grains vanish <= 0.15 s after landing", () => {
    const pool = new GrainPool(64, 7);
    pool.emitStroke(0, 0, 0, 1, 0, 0, DESK_DUSTER_BURST);
    const out = new Float64Array(3);
    for (let i = 0; i < DESK_DUSTER_BURST.count; i++) {
      const k = i * GRAIN_STRIDE;
      const vy = pool.v0[k + 1]!;
      const vx = pool.v0[k]!;
      const land = pool.v0[k + 3]!;
      // apex height and range within 5 % of the analytic values (VT-M1-16)
      const tApex = vy / GRAIN_G;
      expect(pool.sample(i, tApex, out)).toBe(true);
      const apex = pool.p0[k + 1]! + (vy * vy) / (2 * GRAIN_G);
      expect(Math.abs(out[1]! - apex)).toBeLessThan(0.05 * apex + 1e-6);
      expect(pool.sample(i, land, out)).toBe(true);
      expect(Math.abs(out[0]! - (pool.p0[k]! + vx * land))).toBeLessThan(1e-4);
      expect(pool.sample(i, land + VANISH_S + 1e-3, out)).toBe(false);
      expect(VANISH_S).toBeLessThanOrEqual(0.15);
    }
  });

  it("Desk Duster burst stays inside the art-direction ranges and has ~15 % glints over many strokes", () => {
    const pool = new GrainPool(20_000, 3);
    let glints = 0;
    const strokes = 500;
    for (let s = 0; s < strokes; s++) pool.emitStroke(0, 0, 0, 0, 1, 0, DESK_DUSTER_BURST);
    const n = strokes * DESK_DUSTER_BURST.count;
    for (let i = 0; i < n; i++) {
      const k = i * GRAIN_STRIDE;
      const v = Math.hypot(pool.v0[k]!, pool.v0[k + 1]!, pool.v0[k + 2]!);
      expect(v).toBeGreaterThanOrEqual(0.5 - 1e-5);
      expect(v).toBeLessThanOrEqual(1.5 + 1e-5);
      const el = Math.asin(pool.v0[k + 1]! / v);
      expect(el).toBeGreaterThanOrEqual((20 * Math.PI) / 180 - 1e-4);
      expect(el).toBeLessThanOrEqual((60 * Math.PI) / 180 + 1e-4);
      const d = pool.look[k]! * 2;
      expect(d).toBeGreaterThanOrEqual(0.01 - 1e-6);
      expect(d).toBeLessThanOrEqual(0.03 + 1e-6);
      glints += pool.look[k + 2]!;
      // 0.5-1.5 m/s at 20-60 degrees: longest flight 2 * 1.5 * sin 60 / 1.62 = 1.6 s
      expect(pool.v0[k + 3]!).toBeLessThan(1.65);
    }
    expect(glints / n).toBeGreaterThan(0.12);
    expect(glints / n).toBeLessThan(0.18);
  });

  it("recycles oldest-first, reports dirty ranges once, counts live grains", () => {
    const pool = new GrainPool(10, 1);
    const range = { start: 0, count: 0 };
    expect(pool.takeDirty(range)).toBe(false);
    pool.emitStroke(0, 0, 0, 1, 0, 0, { ...DESK_DUSTER_BURST, count: 4 });
    expect(pool.takeDirty(range)).toBe(true);
    expect(range).toEqual({ start: 0, count: 4 });
    expect(pool.takeDirty(range)).toBe(false);
    pool.emitStroke(0, 0, 0, 1, 0, 0, { ...DESK_DUSTER_BURST, count: 8 });
    expect(pool.used).toBe(10);
    expect(pool.takeDirty(range)).toBe(true);
    expect(range.start).toBe(0); // wrapped
    expect(pool.live()).toBe(10);
    pool.advance(5);
    expect(pool.live()).toBe(0);
  });

  it("clock rebases when empty so float32 time keeps sub-ms precision", () => {
    const pool = new GrainPool(8, 1);
    pool.emitStroke(0, 0, 0, 1, 0, 0, { ...DESK_DUSTER_BURST, count: 2 });
    for (let i = 0; i < 700; i++) pool.advance(1);
    expect(pool.time).toBeLessThan(150); // rebased at 600 s
    expect(pool.p0[3]!).toBeLessThan(-500); // launch times moved with the clock
    expect(pool.live()).toBe(0);
  });
});
