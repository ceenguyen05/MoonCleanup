import type { NetProfile } from "./profiles";
import { createRng } from "./rng";

/** Minimum retransmission timeout used for a loss stall, ms (Linux RTO floor is 200 ms). */
export const MIN_RTO_MS = 200;

/**
 * One direction of a conditioned TCP-like pipe. `deliveryTime(now)` returns the absolute time (same clock as `now`)
 * at which a chunk written at `now` may be delivered. Deliveries are monotone, so byte order is preserved and a
 * stalled chunk blocks everything behind it.
 */
export class DirectionConditioner {
  private readonly rng: () => number;
  private lastDelivery = 0;
  /** Chunks that suffered a loss stall. */
  stalls = 0;
  chunks = 0;

  constructor(
    private readonly profile: NetProfile,
    seed: number,
    private readonly startedAt: number,
  ) {
    this.rng = createRng(seed);
  }

  deliveryTime(now: number): number {
    const p = this.profile;
    this.chunks++;
    const oneWay = p.latencyMs / 2;
    const jitter = (p.jitterMs / 2) * (this.rng() * 2 - 1);
    let t = now + Math.max(0, oneWay + jitter);
    if (p.loss > 0 && this.rng() < p.loss) {
      this.stalls++;
      t += Math.max(MIN_RTO_MS, 2 * p.latencyMs);
    }
    if (p.outage) {
      const from = this.startedAt + p.outage.startMs;
      const to = from + p.outage.durationMs;
      if (t >= from && t < to) t = to;
    }
    if (t < this.lastDelivery) t = this.lastDelivery;
    this.lastDelivery = t;
    return t;
  }
}
