import { describe, expect, it } from "vitest";
import { GrainPool, VANISH_S } from "../grains";
import {
  MOMENT_POUR,
  MOMENT_RAILSHOT,
  MOMENT_STAMP,
  MomentFx,
  POUR_FLASH_S,
  STAMP_EMBLEM_S,
  STAMP_OUTLINE_S,
  STAMP_TOTAL_S,
  pourFlash,
  pourSpeedForRange,
  railshotGlow,
  stampEmblemScale,
  stampGlow,
  stampOutlineProgress,
} from "./moments";

describe("stamp curves", () => {
  it("outline completes in 0.6-1.0 s", () => {
    expect(STAMP_OUTLINE_S).toBeGreaterThanOrEqual(0.6);
    expect(STAMP_OUTLINE_S).toBeLessThanOrEqual(1.0);
    expect(stampOutlineProgress(0)).toBe(0);
    expect(stampOutlineProgress(STAMP_OUTLINE_S)).toBe(1);
  });
  it("emblem lands after the outline, dips once below 1 and settles at 1", () => {
    expect(stampEmblemScale(STAMP_OUTLINE_S - 0.01)).toBe(0);
    let min = 9;
    let turns = 0;
    let prevDelta = 0;
    let prev = stampEmblemScale(STAMP_OUTLINE_S + 0.0005);
    for (let t = STAMP_OUTLINE_S + 0.001; t <= STAMP_OUTLINE_S + STAMP_EMBLEM_S; t += 0.001) {
      const s = stampEmblemScale(t);
      min = Math.min(min, s);
      const d = s - prev;
      if (prevDelta < -1e-9 && d > 1e-9) turns++;
      if (Math.abs(d) > 1e-9) prevDelta = d;
      prev = s;
    }
    expect(turns).toBe(1);
    expect(min).toBeLessThan(1);
    expect(stampEmblemScale(STAMP_OUTLINE_S + STAMP_EMBLEM_S + 1)).toBe(1);
  });
  it("glow fades to zero", () => {
    expect(stampGlow(0.5)).toBe(1);
    expect(stampGlow(STAMP_TOTAL_S)).toBeCloseTo(0, 9);
  });
});

describe("pour and railshot", () => {
  it("flash peaks at 0 and ends", () => {
    expect(pourFlash(0)).toBe(1);
    expect(pourFlash(POUR_FLASH_S)).toBe(0);
    expect(railshotGlow(0)).toBe(1);
    expect(railshotGlow(1)).toBe(0);
  });
  it("range speed lands a 45 degree grain at the range", () => {
    const v = pourSpeedForRange(2);
    expect((v * v) / 1.62).toBeCloseTo(2, 6);
  });
});

describe("MomentFx", () => {
  it("bursts: railshot at trigger, stamp at emblem impact, none for pour; slots free themselves", () => {
    const pool = new GrainPool(2048, 3);
    const fx = new MomentFx(pool);
    fx.trigger(MOMENT_RAILSHOT, 0, 0, 0);
    expect(pool.emitted).toBe(500);
    fx.trigger(MOMENT_STAMP, 1, 0, 1, 12);
    fx.trigger(MOMENT_POUR, 0, 1, 0);
    expect(pool.emitted).toBe(500);
    fx.update(STAMP_OUTLINE_S - 0.01);
    expect(pool.emitted).toBe(500);
    fx.update(0.02);
    expect(pool.emitted).toBe(564);
    fx.update(STAMP_TOTAL_S + 1);
    expect(fx.liveCount()).toBe(0);
  });
  it("burst grains are gone VANISH_S after landing", () => {
    const pool = new GrainPool(2048, 5);
    new MomentFx(pool).trigger(MOMENT_RAILSHOT, 0, 0, 0);
    const out = new Float64Array(3);
    for (let i = 0; i < pool.used; i++) {
      const land = pool.v0[i * 4 + 3]!;
      expect(pool.sample(i, land + VANISH_S + 1e-3, out)).toBe(false);
    }
  });
});
