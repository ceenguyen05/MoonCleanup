import { checkHashes, makeBots, percentiles, sleep } from "./common";
import type { ContestCommon, HashCheck, Percentiles, RejectCounts } from "./common";
import type { DustContestTarget } from "./target";

export interface S4Options extends ContestCommon {
  readonly bots?: number;
  /** Hash check cadence in simulated seconds (the real protocol uses 5 s). */
  readonly hashEverySec?: number;
}

export interface S4Result {
  readonly bots: number;
  readonly simSeconds: number;
  readonly strokesSubmitted: number;
  readonly rejected: RejectCounts;
  /** Wall ms of one tick (submit + advance(1)), which includes flushing echoes to every client. */
  readonly tickMs: Percentiles;
  readonly hash: HashCheck;
  /** Server-to-client bytes per second per client over the run. */
  readonly bytesPerSecPerClient: Percentiles;
  readonly eventLoopLagP99Ms: number | null;
  readonly serverCpuMs: number | null;
  readonly rssMb: number | null;
}

/** S4: N headless bots clustered on one spot, all cleaning (world-and-dust section 10). */
export async function runS4(target: DustContestTarget, o: S4Options): Promise<S4Result> {
  const n = o.bots ?? 16;
  const hz = target.simTickHz;
  const ticks = Math.round(o.simSeconds * hz);
  const hashEvery = Math.max(1, Math.round((o.hashEverySec ?? 5) * hz));
  const bots = makeBots(o, n);
  for (const b of bots) await target.joinClient(b.id);
  const ids = bots.map((b) => b.id);
  const rejected: RejectCounts = {};
  const tickMs: number[] = [];
  let submitted = 0;
  let checks = 0;
  let matches = 0;
  for (let t = 1; t <= ticks; t++) {
    const wall0 = performance.now();
    for (const b of bots) {
      const v = target.submitStroke(b.id, b.next(t));
      submitted++;
      if (!v.ok) rejected[v.reason] = (rejected[v.reason] ?? 0) + 1;
    }
    await target.advance(1);
    tickMs.push(performance.now() - wall0);
    if (t % hashEvery === 0 || t === ticks) {
      const r = checkHashes(target, ids);
      checks += r.total;
      matches += r.match;
    }
    if (o.realtime) await sleep(Math.max(0, 1000 / hz - (performance.now() - wall0)));
  }
  const bytes = ids.map((id) => target.clientBytesSent(id) / o.simSeconds);
  return {
    bots: n,
    simSeconds: o.simSeconds,
    strokesSubmitted: submitted,
    rejected,
    tickMs: percentiles(tickMs),
    hash: { checks, matches, matchPct: checks === 0 ? 0 : (100 * matches) / checks },
    bytesPerSecPerClient: percentiles(bytes),
    eventLoopLagP99Ms: target.eventLoopLagP99Ms?.() ?? null,
    serverCpuMs: target.serverCpuMs?.() ?? null,
    rssMb: target.rssMb?.() ?? null,
  };
}
