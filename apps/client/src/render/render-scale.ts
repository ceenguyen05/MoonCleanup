// Render scale holder (docs/architecture/rendering-pipeline.md section 9): the range of the preset, the clamp and the
// pins. The control law lives in `dynres.ts` (`DynamicResolution`); the render module feeds its result to `set()`.
// A pin (`?scale=floor|ceil|<number>`, capture mode) holds the scale and makes `set()` a no-op; a numeric pin is an
// explicit request and is NOT limited to the preset's range (`?scale=1` on Low is 1.0).
//
// The scale applies to the scene pass (and later the AO and bloom passes) through `setResolutionScale`. The canvas
// and the DOM UI always stay at native output resolution (section 15).

import type { DynresQuality } from "@moon-cleanup/shared";
import type { RenderScalePin } from "./url-options";

export function clampScale(scale: number, range: Pick<DynresQuality, "scaleMin" | "scaleMax">): number {
  if (!Number.isFinite(scale)) return range.scaleMax;
  return Math.min(range.scaleMax, Math.max(range.scaleMin, scale));
}

export class RenderScale {
  /** Scale in effect: fraction of the output resolution per axis. */
  current: number;

  private min: number;
  private max: number;
  private pin: RenderScalePin | null;
  private readonly range = { scaleMin: 0, scaleMax: 1 };

  constructor(range: Pick<DynresQuality, "scaleMin" | "scaleMax">, pin: RenderScalePin | null = null) {
    this.min = range.scaleMin;
    this.max = range.scaleMax;
    this.pin = pin;
    this.current = this.resting();
  }

  /** Whether a pin (`?scale=`, capture mode) holds the scale; `set()` is ignored then. */
  get pinned(): boolean {
    return this.pin !== null;
  }

  /** New preset range: the scale restarts at the ceiling (or the pinned end). */
  setRange(range: Pick<DynresQuality, "scaleMin" | "scaleMax">): void {
    this.min = range.scaleMin;
    this.max = range.scaleMax;
    this.current = this.resting();
  }

  setPin(pin: RenderScalePin | null): void {
    this.pin = pin;
    this.current = this.resting();
  }

  /** Requests a scale (dynamic-resolution controller). Returns the scale in effect. */
  set(scale: number): number {
    if (this.pin === null)
      this.current = Number.isFinite(scale) ? Math.min(this.max, Math.max(this.min, scale)) : this.max;
    return this.current;
  }

  /** Range of the current preset. */
  get scaleMin(): number {
    return this.min;
  }

  get scaleMax(): number {
    return this.max;
  }

  /** The range as an object (kept and updated in place: no allocation). */
  rangeOf(): Pick<DynresQuality, "scaleMin" | "scaleMax"> {
    this.range.scaleMin = this.min;
    this.range.scaleMax = this.max;
    return this.range;
  }

  private resting(): number {
    if (typeof this.pin === "number") return this.pin;
    return this.pin === "floor" ? this.min : this.max;
  }
}
