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
  /** Solo checkpoint uploads: <= 60 per hour per player (ADR-0031; the 20 s per-Contract gap is enforced in the repository). */
  soloUpload: [{ points: 60, durationS: 3600 }],
  /**
   * Checkpoint upload SLOT ACQUISITION attempts (security review R2), consumed by the transport before a body is read, so an
   * authenticated client cannot churn slots (connect, hold ~5 s, drop, repeat) without limit. A legitimate client attempts one
   * upload per >= 20 s (plus a few 503 retries), far under these. Per account, and per client address (IPv6 by /64; several
   * players may share one NAT address, so the address allowance is wider).
   */
  uploadSlotAccount: [
    { points: 12, durationS: 60 },
    { points: 120, durationS: 3600 },
  ],
  uploadSlotIp: [{ points: 30, durationS: 60 }],
  /** Save head / download reads (a download is up to 4 pages): per player. */
  saveRead: [{ points: 40, durationS: 60 }],
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

/**
 * Rate-limit key of a client address: an IPv6 address is grouped by its /64 (one subscriber usually owns a whole /64, so
 * per-address keys would let one client mint unlimited keys); IPv4, v4-mapped IPv6 and `unknown` are used as is. Same
 * normalisation as the transport's raw-body slot key (net/http-routes `ipSlotKey`). The address comes from the edge header,
 * so a client cannot choose its formatting.
 */
export function rateKeyForIp(ip: string): string {
  if (!ip.includes(":")) return ip;
  let addr = ip.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped !== null) return mapped[1] ?? ip;
  const [headRaw = "", tailRaw] = addr.split("::", 2);
  const head = headRaw.length > 0 ? headRaw.split(":") : [];
  const tail = tailRaw === undefined || tailRaw.length === 0 ? [] : tailRaw.split(":");
  const fill = tailRaw === undefined ? 0 : Math.max(0, 8 - head.length - tail.length);
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  const prefix = groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "") || "0");
  while (prefix.length < 4) prefix.push("0");
  return `${prefix.join(":")}::/64`;
}

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
