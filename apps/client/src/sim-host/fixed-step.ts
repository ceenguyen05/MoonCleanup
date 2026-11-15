// Drift-compensated fixed-step clock of the sim worker (ADR-0031 "the worker runs the fixed-step accumulator").
// Tick k is due at `base + k * tickMs` on an absolute schedule, so timer jitter never accumulates into drift: a late
// timer runs the missed ticks on its next wake (up to `maxCatchUpTicks`), an early one waits. A stall longer than the
// catch-up window drops the excess ticks once (counted) and continues from "now" instead of spiralling.
// Pure and allocation-free; the caller supplies the time (performance.now() in the worker, a fake in tests).

export interface FixedStepClockOptions {
  readonly tickHz: number;
  /** Most ticks run on one wake (default 4 = 200 ms at 20 Hz). */
  readonly maxCatchUpTicks?: number;
}

export class FixedStepClock {
  readonly tickHz: number;
  readonly tickMs: number;
  readonly maxCatchUpTicks: number;
  private baseMs = 0;
  /** Ticks granted since `baseMs`. */
  private granted = 0;
  private runningFlag = false;
  /** Ticks granted in total. */
  ticksGranted = 0;
  /** Ticks skipped because a stall exceeded the catch-up window. */
  ticksDropped = 0;

  constructor(options: FixedStepClockOptions) {
    if (!(Number.isInteger(options.tickHz) && options.tickHz > 0)) throw new RangeError(`tickHz ${options.tickHz}`);
    this.tickHz = options.tickHz;
    this.tickMs = 1000 / options.tickHz;
    this.maxCatchUpTicks = Math.max(1, options.maxCatchUpTicks ?? 4);
  }

  get running(): boolean {
    return this.runningFlag;
  }

  /** Starts (or restarts after a pause) with tick 1 due one step after `nowMs`. */
  start(nowMs: number): void {
    this.baseMs = nowMs;
    this.granted = 0;
    this.runningFlag = true;
  }

  stop(): void {
    this.runningFlag = false;
  }

  /** Number of ticks to run now (0 .. maxCatchUpTicks). The caller must run exactly that many. */
  due(nowMs: number): number {
    if (!this.runningFlag) return 0;
    const target = Math.floor((nowMs - this.baseMs) / this.tickMs);
    let n = target - this.granted;
    if (n <= 0) return 0;
    if (n > this.maxCatchUpTicks) {
      this.ticksDropped += n - this.maxCatchUpTicks;
      n = this.maxCatchUpTicks;
      this.granted = target - n;
    }
    this.granted += n;
    this.ticksGranted += n;
    // Re-base now and then so the float schedule stays exact over long sessions (k * tickMs grows without bound).
    if (this.granted >= 1 << 20) {
      this.baseMs += this.granted * this.tickMs;
      this.granted = 0;
    }
    return n;
  }

  /** Milliseconds until the next tick is due (>= 0). */
  delayMs(nowMs: number): number {
    const next = this.baseMs + (this.granted + 1) * this.tickMs;
    const d = next - nowMs;
    return d > 0 ? d : 0;
  }

  /** Fraction (0 .. 1) of the current step elapsed at `nowMs` (worker-side interpolation / diagnostics). */
  alpha(nowMs: number): number {
    if (!this.runningFlag) return 0;
    const a = (nowMs - (this.baseMs + this.granted * this.tickMs)) / this.tickMs;
    return a < 0 ? 0 : a > 1 ? 1 : a;
  }
}
