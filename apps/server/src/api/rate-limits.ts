// REST rate limits (security.md section 5): rate-limiter-flexible, in-memory store (single instance; counters reset on
// restart, which is acceptable). A request whose client IP could not be resolved is keyed `unknown` and gets a quarter of
// the normal allowance. Each rule is one or more windows; a request must pass every window.

import { RateLimiterMemory } from "rate-limiter-flexible";

export interface RateRule {
  readonly points: number;
  readonly durationS: number;
}

/** Rule table. Keys are stable names used by the handlers and tests. */
export const RATE_RULES = {
  guestCreate: [
    { points: 5, durationS: 3600 },
    { points: 20, durationS: 86_400 },
  ],
  refresh: [{ points: 60, durationS: 3600 }],
  recover: [{ points: 5, durationS: 3600 }],
  joinByCode: [
    { points: 10, durationS: 60 },
    { points: 50, durationS: 3600 },
  ],
  contractCreate: [{ points: 10, durationS: 86_400 }],
  contractJoin: [{ points: 20, durationS: 60 }],
  playerRest: [{ points: 120, durationS: 60 }],
  ipRest: [{ points: 300, durationS: 60 }],
} as const satisfies Record<string, readonly RateRule[]>;

export type RateRuleName = keyof typeof RATE_RULES;

export type RateDecision = { readonly ok: true } | { readonly ok: false; readonly retryAfterS: number };

export interface RateLimits {
  /** Consumes one point of `rule` for `key` (an IP, or a player id for the per-player rules). */
  consume(rule: RateRuleName, key: string): Promise<RateDecision>;
}

export const UNKNOWN_IP = "unknown";

export function createRateLimits(): RateLimits {
  const normal = new Map<RateRuleName, RateLimiterMemory[]>();
  const tight = new Map<RateRuleName, RateLimiterMemory[]>();
  for (const name of Object.keys(RATE_RULES) as RateRuleName[]) {
    normal.set(
      name,
      RATE_RULES[name].map((r) => new RateLimiterMemory({ points: r.points, duration: r.durationS })),
    );
    tight.set(
      name,
      RATE_RULES[name].map(
        (r) => new RateLimiterMemory({ points: Math.max(1, Math.floor(r.points / 4)), duration: r.durationS }),
      ),
    );
  }
  return {
    async consume(rule, key) {
      const limiters = (key === UNKNOWN_IP ? tight : normal).get(rule) ?? [];
      let retryAfterS = 0;
      for (const limiter of limiters) {
        try {
          await limiter.consume(key);
        } catch (rejection) {
          const ms = (rejection as { msBeforeNext?: number }).msBeforeNext ?? 1000;
          retryAfterS = Math.max(retryAfterS, Math.max(1, Math.ceil(ms / 1000)));
        }
      }
      return retryAfterS === 0 ? { ok: true } : { ok: false, retryAfterS };
    },
  };
}
