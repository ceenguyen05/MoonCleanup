import { describe, expect, it } from "vitest";
import { loadGameData, sunElevationDeg } from "@moon-cleanup/game-data";
import {
  applySunPath,
  DEFAULT_DAY_CYCLE,
  EV_RATE_BRIGHTER_PER_S,
  EV_RATE_DARKER_PER_S,
  ExposureRamp,
  SUNSET_RAMP_S,
  sunAzimuthDeg,
} from "./day-clock";
import {
  createKeyState,
  EV100,
  FILL_FRACTION,
  litFraction,
  resolveKey,
  SUN_LUX_NORMAL,
  sunTerminatorFraction,
} from "./key-light";
import { directionFromAzEl } from "../sky/sky-math";

const EARTH_AZ = 62;
const EARTH_EL = 16;

/** Lit fraction of the Earth at contract time `timeS` on the D1 path. */
function earthLitAt(timeS: number): number {
  const sun = applySunPath(DEFAULT_DAY_CYCLE, timeS, EARTH_AZ, { sunElevationDeg: 0, sunAzimuthDeg: 0 });
  const s = { ...directionFromAzEl(sun.sunAzimuthDeg, sun.sunElevationDeg, { x: 0, y: 0, z: 0 }) };
  const e = { ...directionFromAzEl(EARTH_AZ, EARTH_EL, { x: 0, y: 0, z: 0 }) };
  return litFraction(s.x, s.y, s.z, e.x, e.y, e.z);
}

describe("day clock (D1 sun path)", () => {
  it("default cycle equals the world table", () => {
    const world = loadGameData().world;
    expect(DEFAULT_DAY_CYCLE.dayLengthS).toBe(world.dayLengthS);
    expect(DEFAULT_DAY_CYCLE.daylightFrac).toBe(world.daylightFrac);
    expect(DEFAULT_DAY_CYCLE.contractStartSunPhase).toBe(world.contractStartSunPhase);
  });

  it("30 lit minutes, 30 dark minutes, peak 40 and trough -20 degrees", () => {
    const out = { sunElevationDeg: 0, sunAzimuthDeg: 0 };
    expect(applySunPath(DEFAULT_DAY_CYCLE, 0, EARTH_AZ, out).sunElevationDeg).toBeCloseTo(0, 9);
    expect(applySunPath(DEFAULT_DAY_CYCLE, 900, EARTH_AZ, out).sunElevationDeg).toBeCloseTo(40, 9);
    expect(applySunPath(DEFAULT_DAY_CYCLE, 1800, EARTH_AZ, out).sunElevationDeg).toBeCloseTo(0, 9);
    expect(applySunPath(DEFAULT_DAY_CYCLE, 2700, EARTH_AZ, out).sunElevationDeg).toBeCloseTo(-20, 9);
    let lit = 0;
    for (let t = 0.5; t < 3600; t++) if (sunElevationDeg(DEFAULT_DAY_CYCLE, t) > 0) lit++;
    expect(lit).toBe(1800);
  });

  it("azimuth is continuous over the day and wraps once", () => {
    let previous = sunAzimuthDeg(DEFAULT_DAY_CYCLE, 0, EARTH_AZ);
    let turned = 0;
    for (let t = 1; t <= 3600; t++) {
      const az = sunAzimuthDeg(DEFAULT_DAY_CYCLE, t, EARTH_AZ);
      const step = ((az - previous + 540) % 360) - 180;
      expect(Math.abs(step)).toBeLessThan(0.2);
      turned += step;
      previous = az;
    }
    expect(turned).toBeCloseTo(360, 6);
  });

  it("Earth phase from geometry: noon new, dawn and dusk half, midnight full (VT-M1-11, within 10 %)", () => {
    expect(earthLitAt(900)).toBeLessThan(0.1);
    expect(Math.abs(earthLitAt(0) - 0.5)).toBeLessThan(0.1);
    expect(Math.abs(earthLitAt(1800) - 0.5)).toBeLessThan(0.1);
    expect(earthLitAt(2700)).toBeGreaterThan(0.9);
    // Waxing through the afternoon and evening, waning after midnight.
    for (let t = 960; t <= 2700; t += 60) expect(earthLitAt(t)).toBeGreaterThan(earthLitAt(t - 60));
    for (let t = 2760; t <= 3600; t += 60) expect(earthLitAt(t)).toBeLessThan(earthLitAt(t - 60));
  });
});

describe("terminator handover", () => {
  it("the sun's light fades to zero exactly at the handover and is whole from +0.5 degrees", () => {
    expect(sunTerminatorFraction(-0.5)).toBe(0);
    expect(sunTerminatorFraction(0)).toBeCloseTo(0.5, 9);
    expect(sunTerminatorFraction(0.5)).toBe(1);
    expect(sunTerminatorFraction(4)).toBe(1);
    const k = createKeyState();
    expect(resolveKey(4, EARTH_EL, 0.5, k)).toMatchObject({ mode: "sun", sunNormalLux: SUN_LUX_NORMAL, floorLux: 0 });
    expect(resolveKey(-0.499, EARTH_EL, 0.5, k).sunNormalLux).toBeLessThan(1);
  });

  it("flat ground and the exposure are continuous across the sun / Earth handover", () => {
    const sunSide = { ...resolveKey(-0.4999, EARTH_EL, 0.5, createKeyState()) };
    const earthSide = { ...resolveKey(-0.5001, EARTH_EL, 0.5, createKeyState()) };
    expect(sunSide.mode).toBe("sun");
    expect(earthSide.mode).toBe("earth");
    expect(sunSide.ev100).toBe(earthSide.ev100);
    expect(sunSide.floorIsEarth).toBe(true);
    // Under the Earth key flat ground gets the direct light and the up-facing fill; before it, the ambient carry-over.
    const earthFlat = earthSide.earthLux * (Math.sin((EARTH_EL * Math.PI) / 180) + FILL_FRACTION.up);
    expect(sunSide.floorLux / earthFlat).toBeGreaterThan(0.999);
    expect(sunSide.floorLux / earthFlat).toBeLessThanOrEqual(1);
  });

  it("far side: the floor is carried the same way, at the far-side night exposure", () => {
    const sunSide = { ...resolveKey(-0.4999, -20, 0.5, createKeyState()) };
    const night = { ...resolveKey(-0.5001, -20, 0.5, createKeyState()) };
    expect(night.mode).toBe("floor");
    expect(sunSide.ev100).toBe(night.ev100);
    expect(sunSide.floorIsEarth).toBe(false);
    expect(sunSide.floorLux / night.floorLux).toBeGreaterThan(0.999);
  });

  it("in the band the exposure opens no faster than the disk sinks: sunlit surfaces never get brighter", () => {
    const k = createKeyState();
    const dawn = { ...resolveKey(4, EARTH_EL, 0.5, k) };
    let previousEv = dawn.ev100;
    for (let el = 0.5; el >= -0.5; el -= 0.01) {
      resolveKey(el, EARTH_EL, 0.5, k);
      // Display level of a sun-facing surface relative to dawn: lux x pre-exposure scale.
      const relative = (k.sunNormalLux * k.scale) / (dawn.sunNormalLux * dawn.scale);
      expect(relative).toBeLessThanOrEqual(1 + 1e-9);
      expect(k.ev100).toBeLessThanOrEqual(previousEv + 1e-12);
      expect(k.ev100).toBeGreaterThanOrEqual(EV100.nightNear);
      previousEv = k.ev100;
    }
    // Above the band nothing changed.
    expect(resolveKey(0.5, EARTH_EL, 0.5, k).ev100).toBe(EV100.dawn);
  });

  it("grazing sun keeps the dawn key's bounce fill; 4 degrees and up are unchanged", () => {
    const k = createKeyState();
    const dawnFill = SUN_LUX_NORMAL * Math.sin((4 * Math.PI) / 180);
    expect(resolveKey(30, EARTH_EL, 0.5, k).keyLux).toBeCloseTo(SUN_LUX_NORMAL * 0.5, 6);
    expect(resolveKey(4, EARTH_EL, 0.5, k).keyLux).toBeCloseTo(dawnFill, 6);
    expect(resolveKey(2, EARTH_EL, 0.5, k).keyLux).toBeCloseTo(dawnFill, 6);
    expect(resolveKey(0.6, EARTH_EL, 0.5, k).keyLux).toBeCloseTo(dawnFill, 6);
    // The direct light on flat ground stays physical.
    expect(resolveKey(2, EARTH_EL, 0.5, k).sunLux).toBeCloseTo(SUN_LUX_NORMAL * Math.sin((2 * Math.PI) / 180), 6);
    expect(resolveKey(-0.4999, EARTH_EL, 0.5, k).keyLux).toBeLessThan(0.01);
  });
});

describe("exposure ramp", () => {
  it("snaps with the clock stopped and on the first step", () => {
    const ramp = new ExposureRamp();
    expect(ramp.step(EV100.dawn, 0.016, true)).toBe(EV100.dawn);
    expect(ramp.step(EV100.nightNear, 0.016, false)).toBe(EV100.nightNear);
  });

  it("sunset: dawn EV to night EV in 8 s, never overshooting", () => {
    const ramp = new ExposureRamp();
    ramp.step(EV100.dawn, 0, true);
    let t = 0;
    let previous: number = EV100.dawn;
    while (ramp.ev > EV100.nightNear && t < 20) {
      const ev = ramp.step(EV100.nightNear, 1 / 60, true);
      expect(ev).toBeLessThanOrEqual(previous);
      expect(ev).toBeGreaterThanOrEqual(EV100.nightNear);
      previous = ev;
      t += 1 / 60;
    }
    expect(t).toBeGreaterThan(SUNSET_RAMP_S - 0.05);
    expect(t).toBeLessThan(SUNSET_RAMP_S + 0.05);
    expect(EV_RATE_DARKER_PER_S).toBeCloseTo((EV100.dawn - EV100.nightNear) / 8, 9);
  });

  it("sunrise: the exposure falls at 3 EV/s", () => {
    const ramp = new ExposureRamp();
    ramp.step(EV100.nightNear, 0, true);
    expect(ramp.step(EV100.dawn, 0.5, true)).toBeCloseTo(EV100.nightNear + EV_RATE_BRIGHTER_PER_S * 0.5, 9);
    expect(ramp.step(EV100.dawn, 5, true)).toBe(EV100.dawn);
  });
});
