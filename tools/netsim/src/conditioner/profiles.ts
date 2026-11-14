/**
 * Network profiles (netcode.md section 17). Latency and jitter are ROUND-TRIP values: the conditioner applies half of
 * each in every direction, so a client that echoes a ping measures `latencyMs` +/- `jitterMs`.
 * Loss is modelled as a TCP stall: a "lost" chunk is held for one retransmission timeout and, because TCP is ordered,
 * everything behind it waits too (head-of-line blocking).
 */
export interface NetProfile {
  readonly name: string;
  /** Round-trip latency in ms. */
  readonly latencyMs: number;
  /** Round-trip jitter amplitude in ms (uniform +/-). */
  readonly jitterMs: number;
  /** Probability 0..1 that a chunk suffers a retransmission stall. */
  readonly loss: number;
  /** Extra hold on the first client-to-server chunk of each connection (server cold start). */
  readonly connectDelayMs?: number;
  /** Blackhole window relative to the proxy start: traffic is held (not dropped) until it ends. */
  readonly outage?: { readonly startMs: number; readonly durationMs: number };
}

export const PROFILES = {
  clean: { name: "clean", latencyMs: 0, jitterMs: 0, loss: 0 },
  good: { name: "good", latencyMs: 40, jitterMs: 6, loss: 0 },
  // The standard /bot-test profile: 120 ms +/- 30 ms, 1 % loss.
  typical: { name: "typical", latencyMs: 120, jitterMs: 30, loss: 0.01 },
  // Harsh profile: 250 ms, 5 % loss.
  bad: { name: "bad", latencyMs: 250, jitterMs: 50, loss: 0.05 },
  // typical plus a 5 s blackhole starting 30 s in.
  outage: { name: "outage", latencyMs: 120, jitterMs: 30, loss: 0.01, outage: { startMs: 30_000, durationMs: 5_000 } },
  // Server cold start (Render Free spin-up): every new connection hangs first.
  coldstart: { name: "coldstart", latencyMs: 120, jitterMs: 30, loss: 0.01, connectDelayMs: 8_000 },
} as const satisfies Record<string, NetProfile>;

export type ProfileName = keyof typeof PROFILES;

export function isProfileName(value: string): value is ProfileName {
  return Object.hasOwn(PROFILES, value);
}
