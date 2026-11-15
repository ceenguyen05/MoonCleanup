// Allocation-free token bucket for per-connection message limits (netcode.md section 11). `rate-limiter-flexible`
// stays on the REST edge (async, allocates a result per call); the room hot path uses this synchronous bucket.

import type { RateLimitSpec } from "@moon-cleanup/shared";

export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly perSecond: number,
    private readonly burst: number,
    now: number,
  ) {
    this.tokens = burst;
    this.last = now;
  }

  static of(spec: RateLimitSpec, now: number): TokenBucket {
    return new TokenBucket(spec.perSecond, spec.burst, now);
  }

  /** Takes one token. False (nothing taken) when the bucket is empty. `now` is epoch or monotonic ms. */
  take(now: number): boolean {
    const elapsed = now - this.last;
    if (elapsed > 0) {
      this.tokens = Math.min(this.burst, this.tokens + (elapsed * this.perSecond) / 1000);
      this.last = now;
    }
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** Back to a full bucket (seat reused). */
  reset(now: number): void {
    this.tokens = this.burst;
    this.last = now;
  }
}
