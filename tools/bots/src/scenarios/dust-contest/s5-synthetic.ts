import type { RobotPlotIntent } from "@moon-cleanup/shared";
import { createRng } from "../../rng";
import { makeBots, percentiles, sleep } from "./common";
import type { ContestCommon, Percentiles } from "./common";
import type { DustContestTarget } from "./target";

export interface S5Options extends ContestCommon {
  readonly robots?: number;
  readonly bots?: number;
  /** Number of consecutive PlotIds, from the cluster plot, that robots pick work from. */
  readonly plotSpread?: number;
}

export interface S5Result {
  readonly robots: number;
  readonly bots: number;
  readonly simSeconds: number;
  readonly intents: number;
  readonly intentBytes: number;
  readonly intentBytesPerSec: number;
  readonly tickMs: Percentiles;
  readonly serverCpuMs: number | null;
  readonly rssMb: number | null;
}

/** Robot mix of S5: sweeper-class, vacuum-class and big-brush robots (work width cm, speed cm/s, depth16). */
const ROBOT_KINDS = [
  { widthCm: 80, speedCmPerS: 120, depth16: 16 },
  { widthCm: 140, speedCmPerS: 90, depth16: 32 },
  { widthCm: 200, speedCmPerS: 60, depth16: 48 },
] as const;

const lowMask = (lanes: number): number => (lanes >= 32 ? 0xffff_ffff : (2 ** lanes - 1) >>> 0);

/**
 * S5 synthetic ledger-op load: 400 mixed robots each announce one plot of lanes (a RobotPlotIntent) as soon as the
 * previous plot is done, plus 4 stroking bots. Intent timing follows lanes x plot length / speed, so the intent rate
 * is what a real fleet would produce; the target expands intents into ledger ops itself.
 */
export async function runS5(target: DustContestTarget, o: S5Options): Promise<S5Result> {
  const robots = o.robots ?? 400;
  const nBots = o.bots ?? 4;
  const hz = target.simTickHz;
  const ticks = Math.round(o.simSeconds * hz);
  const rng = createRng(o.seed ^ 0x5eed5);
  const bots = makeBots(o, nBots);
  for (const b of bots) await target.joinClient(b.id);
  const spread = o.plotSpread ?? 256;
  const fleet = Array.from({ length: robots }, (_, id) => {
    const kind = ROBOT_KINDS[id % ROBOT_KINDS.length] ?? ROBOT_KINDS[0];
    const lanes = Math.ceil(25.6 / (kind.widthCm / 100));
    const plotSeconds = (lanes * 25.6) / (kind.speedCmPerS / 100);
    return { id, kind, lanes, periodTicks: Math.max(1, Math.round(plotSeconds * hz)), due: Math.floor(rng() * hz * 5) };
  });
  let intents = 0;
  let intentBytes = 0;
  const tickMs: number[] = [];
  for (let t = 1; t <= ticks; t++) {
    const wall0 = performance.now();
    for (const b of bots) target.submitStroke(b.id, b.next(t));
    for (const r of fleet) {
      if (t < r.due) continue;
      r.due = t + r.periodTicks;
      const plotId = (o.clusterPlot + Math.floor(rng() * spread)) % o.grid.params.plotCount;
      const intent: RobotPlotIntent = {
        robotId: r.id,
        plotId: plotId as RobotPlotIntent["plotId"],
        startTick: t as RobotPlotIntent["startTick"],
        widthCm: r.kind.widthCm,
        depth16: r.kind.depth16,
        speedCmPerS: r.kind.speedCmPerS,
        laneMask: [lowMask(r.lanes), r.lanes > 32 ? lowMask(r.lanes - 32) : 0],
      };
      intentBytes += target.submitRobotIntent(intent);
      intents++;
    }
    await target.advance(1);
    tickMs.push(performance.now() - wall0);
    if (o.realtime) await sleep(Math.max(0, 1000 / hz - (performance.now() - wall0)));
  }
  return {
    robots,
    bots: nBots,
    simSeconds: o.simSeconds,
    intents,
    intentBytes,
    intentBytesPerSec: intentBytes / o.simSeconds,
    tickMs: percentiles(tickMs),
    serverCpuMs: target.serverCpuMs?.() ?? null,
    rssMb: target.rssMb?.() ?? null,
  };
}
