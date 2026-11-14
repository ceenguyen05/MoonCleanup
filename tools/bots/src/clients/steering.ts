// Client input-clock steering (netcode.md section 5.1). The server consumes exactly one input sequence number per
// tick, real or substituted, and drops any input whose seq is <= the last consumed one as late. A client that merely
// sends one input per tick therefore never recovers once a stall lets the server substitute ahead of it. The bot
// steers its send COUNT (0, 1 or 2 per tick) from the acked seq in each FRAME so the server always holds a small,
// positive queue; the seq counter itself only jumps (to ack + 1) when every pending input would be late.

/** Inputs the server should hold in hand beyond the in-flight round trip. */
export const LEAD_TICKS = 3;
/** Skip a send when this far above target; catch up with two inputs when this far below. */
const HIGH_SLACK = 3;
const LOW_SLACK = 1;

export interface SteerInput {
  /** Last seq this client sent (u16 domain, 0 before the first send). */
  readonly seq: number;
  /** Last acked (consumed) seq from the newest FRAME, or -1 before any frame. */
  readonly ack: number;
  readonly rttMs: number;
  readonly tickMs: number;
}

export interface SteerResult {
  /** Inputs to send now: 0 (skip), 1 or 2. */
  count: 0 | 1 | 2;
  /** When set (>= 0), jump the counter so that the next sent seq is this value (hard resync). */
  resyncSeq: number;
}

const signed16 = (v: number): number => ((v + 0x8000) & 0xffff) - 0x8000;

/** Target distance, in inputs, between the client's newest seq and the server's last consumed seq. */
export function targetGap(rttMs: number, tickMs: number): number {
  return Math.ceil(rttMs / tickMs) + LEAD_TICKS;
}

export function steer(input: SteerInput, out: SteerResult): SteerResult {
  out.count = 1;
  out.resyncSeq = -1;
  if (input.ack < 0) return out;
  const target = targetGap(input.rttMs, input.tickMs);
  const gap = signed16(input.seq - input.ack);
  if (gap <= 0 || gap > 0x2000) {
    // Behind (every input would be late) or hopelessly ahead: restart right after the acked seq and send two.
    // The server consumes the next QUEUED input whatever its seq (FIFO, any seq ahead of the last consumed one), so
    // a seq jump adds no lead: jumping to `ack + target` (the old rule) left the queue empty, the next frame acked the
    // jumped seq, `gap` hit 0 again and the bot resynced on every frame (~12 % of inputs on clean loopback, up to 50 %
    // for an unlucky timer phase). Only extra inputs build lead; the `count = 2` branch below does the rest.
    out.resyncSeq = (input.ack + 1) & 0xffff;
    out.count = 2;
    return out;
  }
  if (gap > target + HIGH_SLACK) out.count = 0;
  else if (gap < target - LOW_SLACK) out.count = 2;
  return out;
}

export { signed16 };
