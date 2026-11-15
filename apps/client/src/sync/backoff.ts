// Retry delay of a failed upload: 30 s after the first failure, doubling, capped at 5 minutes, with +/- 20% jitter so
// many tabs that lost the server together do not retry together. A server `retry-after` raises the delay, never lowers it.

import { BACKOFF_BASE_MS, BACKOFF_JITTER, BACKOFF_MAX_MS } from "./limits";

/** Delay before attempt number `failures + 1`; `failures >= 1` is the count of consecutive failed attempts. */
export function backoffDelayMs(failures: number, random: () => number, retryAfterMs: number | null = null): number {
  const n = Math.max(1, Math.floor(failures));
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (n - 1));
  const jittered = exp * (1 + (random() * 2 - 1) * BACKOFF_JITTER);
  const delay = Math.min(BACKOFF_MAX_MS, Math.max(BACKOFF_BASE_MS * (1 - BACKOFF_JITTER), jittered));
  return retryAfterMs === null ? delay : Math.max(delay, retryAfterMs);
}
