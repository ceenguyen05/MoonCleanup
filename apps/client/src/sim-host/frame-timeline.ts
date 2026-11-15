// Render interpolation hook for local frames: remembers when the last two authoritative frames arrived and turns
// "now" into a fractional render tick, so render code can blend the previous and newest decoded state. Pure, no
// allocation; the host feeds it on every frame and the renderer samples it once per animation frame.

export interface FrameTimelineSample {
  /** Tick of the newest frame. */
  tick: number;
  /** 0 .. 1 blend from the previous frame (0) to the newest (1) at `nowMs`. */
  alpha: number;
  /** `tick - 1 + alpha`: fractional tick for the render (one tick of interpolation delay). */
  renderTick: number;
}

export class FrameTimeline {
  private lastTick = -1;
  private lastArrivalMs = 0;
  private readonly tickMs: number;

  constructor(tickHz: number) {
    this.tickMs = 1000 / tickHz;
  }

  onFrame(tick: number, arrivalMs: number): void {
    this.lastTick = tick;
    this.lastArrivalMs = arrivalMs;
  }

  sample(nowMs: number, out: FrameTimelineSample): FrameTimelineSample {
    if (this.lastTick < 0) {
      out.tick = 0;
      out.alpha = 0;
      out.renderTick = 0;
      return out;
    }
    const a = (nowMs - this.lastArrivalMs) / this.tickMs;
    out.tick = this.lastTick;
    out.alpha = a < 0 ? 0 : a > 1 ? 1 : a;
    out.renderTick = this.lastTick - 1 + out.alpha;
    return out;
  }
}
