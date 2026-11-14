// Client/server clock offset from PING/PONG (netcode.md section 6: "serverTick + clock offset from PING/PONG, EMA of
// RTT/2"). Pure arithmetic, no clock of its own: the caller passes its local clock in milliseconds (any monotonic
// clock, for example performance.now()), the same clock it used to stamp the PING (modulo 2^32 on the wire).
//
// Definition: `serverTimeMs = localTimeMs + offsetMs`, where serverTimeMs = serverTick * tickMs (the server timeline
// of FRAME headers and PONGs). A tick is a u32 and the timeline is not unwrapped: at 20 Hz it wraps after 6.8 years.
//
// Estimator: one sample per PONG, offset = (serverTick + 0.5) * tickMs + rtt / 2 - nowMs. The +0.5 centres the tick
// quantisation. Samples whose RTT is more than 2 x the best RTT of the last 8 are skipped (a queued reply says
// nothing about the path), the rest feed an EMA (alpha 0.2; the first sample is taken as is). A sample more than
// 500 ms away from the estimate is a jump (server restart, suspended laptop): it replaces the estimate instead of
// being averaged. Before the first PONG a FRAME arrival gives a provisional offset (zero latency assumed), so the
// interpolation buffer can start at once; the first PONG replaces it.

import { rttFromPong } from "../codec/ping";

/** EMA weight of a new accepted PONG sample. */
export const CLOCK_EMA_ALPHA = 0.2;
/** A sample this far (ms) from the estimate replaces it instead of being averaged. */
export const CLOCK_JUMP_MS = 500;
/** RTT history length used for the best-RTT filter. */
export const CLOCK_RTT_WINDOW = 8;
/** Samples whose RTT exceeds this multiple of the best recent RTT are skipped. */
export const CLOCK_RTT_REJECT_FACTOR = 2;

export class ClockSync {
  /** `serverTimeMs = localTimeMs + offsetMs`. Meaningful once `hasEstimate`. */
  offsetMs = 0;
  /** EMA of the PONG round trip time, ms. */
  rttMs = 0;
  /** Accepted PONG samples. */
  samples = 0;
  /** PONGs skipped by the RTT filter or as stale. */
  rejected = 0;
  /** True after the first provisional or PONG estimate. */
  hasEstimate = false;
  /** Milliseconds per sim tick (1000 / simTickHz). */
  tickMs: number;

  private readonly rtts = new Float64Array(CLOCK_RTT_WINDOW);
  private rttCount = 0;
  private rttHead = 0;

  constructor(tickMs = 50) {
    this.tickMs = tickMs;
  }

  /** Sets the tick length from the hello (`simTickHz`). Keeps the estimate. */
  configure(simTickHz: number): void {
    if (simTickHz > 0) this.tickMs = 1000 / simTickHz;
  }

  reset(): void {
    this.offsetMs = 0;
    this.rttMs = 0;
    this.samples = 0;
    this.rejected = 0;
    this.hasEstimate = false;
    this.rttCount = 0;
    this.rttHead = 0;
  }

  /**
   * Provisional estimate from a FRAME arrival, only used while there is no PONG sample (zero latency assumed, so the
   * buffer's delay is short by the one-way latency until the first PONG, which comes within the first ping burst).
   */
  provisionalFromFrame(serverTick: number, nowMs: number): void {
    if (this.samples > 0) return;
    this.offsetMs = serverTick * this.tickMs - nowMs;
    this.hasEstimate = true;
  }

  /**
   * Feeds one PONG. `nowMs` is the local clock at receipt, `echoedClientTimeMs` the u32 the PING carried (the local
   * clock at send, modulo 2^32), `serverTick` the PONG's tick. Returns true when the sample was accepted.
   */
  onPong(nowMs: number, echoedClientTimeMs: number, serverTick: number): boolean {
    const rtt = rttFromPong(nowMs, echoedClientTimeMs);
    if (rtt < 0) {
      this.rejected++;
      return false;
    }
    let best = rtt;
    for (let i = 0; i < this.rttCount; i++) {
      const r = this.rtts[i] ?? rtt;
      if (r < best) best = r;
    }
    this.rtts[this.rttHead] = rtt;
    this.rttHead = (this.rttHead + 1) % CLOCK_RTT_WINDOW;
    if (this.rttCount < CLOCK_RTT_WINDOW) this.rttCount++;
    // Always keep the very first sample, then filter queued replies.
    if (this.samples > 0 && rtt > best * CLOCK_RTT_REJECT_FACTOR + 5) {
      this.rejected++;
      return false;
    }
    const sample = (serverTick + 0.5) * this.tickMs + rtt * 0.5 - nowMs;
    if (this.samples === 0) {
      this.offsetMs = sample;
      this.rttMs = rtt;
    } else if (Math.abs(sample - this.offsetMs) > CLOCK_JUMP_MS) {
      this.offsetMs = sample;
      this.rttMs = rtt;
    } else {
      this.offsetMs += (sample - this.offsetMs) * CLOCK_EMA_ALPHA;
      this.rttMs += (rtt - this.rttMs) * CLOCK_EMA_ALPHA;
    }
    this.samples++;
    this.hasEstimate = true;
    return true;
  }

  /** Server time (ms) at local time `nowMs`. */
  serverTimeAt(nowMs: number): number {
    return nowMs + this.offsetMs;
  }
}
