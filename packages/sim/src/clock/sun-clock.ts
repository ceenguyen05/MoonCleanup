// Sun / time clock (world.json dayLengthS, daylightFrac, contractStartSunPhase; decision D1). Integer tick arithmetic:
// the day position is (startPhaseTicks + tick) mod dayTicks, so every host agrees exactly. Sun elevation for event
// payloads comes from game-data `sunElevationDeg` (presentation value, never fed back into state).

import type { DayPhase } from "@moon-cleanup/shared";
import { sunElevationDeg } from "@moon-cleanup/game-data";
import type { SimConfig } from "../config/sim-config";

/** Tick position inside the day, 0 .. dayTicks - 1 (0 = sunrise when contractStartSunPhase is 0). */
export function dayTickOf(cfg: SimConfig, tick: number): number {
  return (cfg.startPhaseTicks + tick) % cfg.dayTicks;
}

/** Day phase in [0, 1). */
export function sunPhase01(cfg: SimConfig, tick: number): number {
  return dayTickOf(cfg, tick) / cfg.dayTicks;
}

export function isDaylightAt(cfg: SimConfig, tick: number): boolean {
  return dayTickOf(cfg, tick) < cfg.daylightTicks;
}

/** dawn / day / dusk / night by integer tick bands (dawn and dusk = first / last TWILIGHT share of the lit half). */
export function dayPhaseAt(cfg: SimConfig, tick: number): DayPhase {
  const d = dayTickOf(cfg, tick);
  if (d >= cfg.daylightTicks) return "night";
  if (d < cfg.twilightTicks) return "dawn";
  if (d >= cfg.daylightTicks - cfg.twilightTicks) return "dusk";
  return "day";
}

/** Seconds until the next sunrise or sunset. */
export function secondsToTerminator(cfg: SimConfig, tick: number): number {
  const d = dayTickOf(cfg, tick);
  const left = d < cfg.daylightTicks ? cfg.daylightTicks - d : cfg.dayTicks - d;
  return left / cfg.tickHz;
}

/** Sun elevation in degrees (presentation only). */
export function sunElevationAt(cfg: SimConfig, tick: number): number {
  return sunElevationDeg(
    { dayLengthS: cfg.dayLengthS, daylightFrac: cfg.daylightFrac, contractStartSunPhase: cfg.contractStartSunPhase },
    tick / cfg.tickHz,
  );
}
